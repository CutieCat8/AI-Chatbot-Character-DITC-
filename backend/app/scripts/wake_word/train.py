"""Train and evaluate the local Thai wake-word classifier.

The model intentionally favours precision.  A kiosk waking up on ordinary
"สวัสดี" is materially worse than asking a visitor to repeat the phrase.
"""
from __future__ import annotations

import os

# tensorflowjs's browser-side runtime (tfjs-layers) cannot deserialize Keras 3's
# model_config schema (InputLayer's `batch_shape` vs the old `batch_input_shape`,
# and a restructured `inbound_nodes` format) — confirmed 2026-09-11 by loading a
# Keras-3-exported model.json through @tensorflow/tfjs 4.22 and hitting both
# errors. tensorflowjs itself depends on `tf_keras` for this reason; must set
# this before `import tensorflow` so `tf.keras` resolves to legacy Keras 2.
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import argparse
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
import tensorflow as tf

SAMPLE_RATE = 16000
CLIP_SAMPLES = 32000     # 2.0 s (เดิม 25600 / 1.6s — ปรับ 2026-09-11)
FRAME_LENGTH = 640       # 40 ms
FRAME_STEP = 320         # 20 ms
FFT_LENGTH = 1024
NUM_MELS = 40
LOWER_HZ = 80.0
UPPER_HZ = 7600.0


def log_mel(waveforms: tf.Tensor) -> tf.Tensor:
    """Return [batch, 99, 40, 1], using the exact constants in wakeWordFeatures.ts."""
    waveforms = tf.cast(waveforms, tf.float32)
    stft = tf.signal.stft(waveforms, FRAME_LENGTH, FRAME_STEP, FFT_LENGTH, window_fn=tf.signal.hann_window)
    power = tf.math.square(tf.abs(stft))
    mel_matrix = tf.signal.linear_to_mel_weight_matrix(
        NUM_MELS, FFT_LENGTH // 2 + 1, SAMPLE_RATE, LOWER_HZ, UPPER_HZ
    )
    mel = tf.tensordot(power, mel_matrix, 1)
    mel.set_shape(power.shape[:-1].concatenate(mel_matrix.shape[-1:]))
    # Natural log with a floor prevents -inf on silence and is portable to JS.
    return tf.expand_dims(tf.math.log(tf.maximum(mel, 1e-6)), -1)


def load_clip(path: Path) -> np.ndarray:
    data, sample_rate = sf.read(path, dtype="float32")
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"{path}: expected {SAMPLE_RATE} Hz, got {sample_rate}")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if len(data) != CLIP_SAMPLES:
        raise ValueError(f"{path}: expected {CLIP_SAMPLES} samples, got {len(data)}")
    return data


def group_key(path: Path) -> str:
    """Keep augmentations of a base utterance together to prevent leakage."""
    stem = re.sub(r"_aug\d+$", "", path.stem)
    # noise clips are independently generated, so a stable individual split is fine.
    return stem


def split_paths(paths: list[Path]) -> tuple[list[Path], list[Path], list[Path]]:
    """Deterministic grouped 70/15/15 split; no augmented sibling crosses splits."""
    groups: dict[str, list[Path]] = {}
    for path in paths:
        groups.setdefault(group_key(path), []).append(path)
    keys = sorted(groups)
    rng = np.random.default_rng(20260908)
    rng.shuffle(keys)
    n = len(keys)
    train_n = max(1, round(n * 0.70))
    val_n = max(1, round(n * 0.15))
    if train_n + val_n >= n:
        val_n = 1
        train_n = max(1, n - 2)
    partitions = (keys[:train_n], keys[train_n : train_n + val_n], keys[train_n + val_n :])
    return tuple([p for key in partition for p in groups[key]] for partition in partitions)  # type: ignore[return-value]


def build_model() -> tf.keras.Model:
    inputs = tf.keras.Input(shape=(99, NUM_MELS, 1), name="log_mel")
    x = tf.keras.layers.Conv2D(12, (3, 3), activation="relu", padding="same")(inputs)
    x = tf.keras.layers.MaxPool2D((2, 2))(x)
    x = tf.keras.layers.SeparableConv2D(20, (3, 3), activation="relu", padding="same")(x)
    x = tf.keras.layers.MaxPool2D((2, 2))(x)
    x = tf.keras.layers.SeparableConv2D(28, (3, 3), activation="relu", padding="same")(x)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.20)(x)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid", name="wake_probability")(x)
    model = tf.keras.Model(inputs, outputs, name="thai_wake_word")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=[tf.keras.metrics.Precision(name="precision"), tf.keras.metrics.Recall(name="recall")],
    )
    return model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=35)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--threshold", type=float, default=0.98, help="strict deployment threshold")
    args = parser.parse_args()
    tf.keras.utils.set_random_seed(20260908)

    positive = sorted((args.dataset / "positive").glob("*.wav"))
    negative = sorted((args.dataset / "negative").glob("*.wav"))
    if not positive or not negative:
        raise SystemExit("dataset must contain positive/*.wav and negative/*.wav")
    pos_splits, neg_splits = split_paths(positive), split_paths(negative)

    def make_split(index: int) -> tuple[np.ndarray, np.ndarray]:
        paths = pos_splits[index] + neg_splits[index]
        labels = np.array([1] * len(pos_splits[index]) + [0] * len(neg_splits[index]), dtype=np.float32)
        waves = np.stack([load_clip(path) for path in paths])
        order = np.random.default_rng(100 + index).permutation(len(paths))
        return waves[order], labels[order]

    train_wave, train_y = make_split(0)
    val_wave, val_y = make_split(1)
    test_wave, test_y = make_split(2)
    train_x, val_x, test_x = (log_mel(w) for w in (train_wave, val_wave, test_wave))
    model = build_model()
    args.out.mkdir(parents=True, exist_ok=True)
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_loss", mode="min", patience=7, restore_best_weights=True),
        tf.keras.callbacks.ModelCheckpoint(str(args.out / "best.keras"), monitor="val_loss", mode="min", save_best_only=True),
    ]
    # Synthetic data contains many deliberate negatives. Balance the loss so
    # the trivial "always negative" classifier cannot appear safe merely by
    # having zero false accepts.
    class_weight = {0: 1.0, 1: len(neg_splits[0]) / len(pos_splits[0])}
    model.fit(train_x, train_y, validation_data=(val_x, val_y), epochs=args.epochs, batch_size=args.batch_size,
              class_weight=class_weight, callbacks=callbacks, verbose=2)
    probabilities = model.predict(test_x, verbose=0).reshape(-1)
    predictions = probabilities >= args.threshold
    tp = int(np.sum(predictions & (test_y == 1)))
    fp = int(np.sum(predictions & (test_y == 0)))
    fn = int(np.sum(~predictions & (test_y == 1)))
    tn = int(np.sum(~predictions & (test_y == 0)))
    report = {
        "threshold": args.threshold, "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "recall": tp / (tp + fn) if tp + fn else 0.0,
        "false_accept_rate": fp / (fp + tn) if fp + tn else 0.0,
        "split_counts": {"train": len(train_y), "validation": len(val_y), "test": len(test_y)},
        "warning": "Synthetic TTS-only result; this is not evidence of real-speaker performance.",
    }
    model.save(args.out / "model.keras")
    (args.out / "evaluation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if fp or tp == 0 or report["precision"] < 0.95 or report["recall"] < 0.50:
        raise SystemExit(
            "FAILED strict gate: require zero held-out false accepts, precision >= 0.95, and recall >= 0.50; do not deploy"
        )


if __name__ == "__main__":
    main()
