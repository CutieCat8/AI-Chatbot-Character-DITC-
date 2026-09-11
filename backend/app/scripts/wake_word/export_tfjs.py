"""Export a trained Keras wake-word model to the browser's TensorFlow.js format."""
from __future__ import annotations

import os

# Must match train.py: a model saved under Keras 3 cannot even be loaded back
# by legacy tf_keras (confirmed 2026-09-11 — different error, not just a schema
# mismatch), so this has to be set here too, before `import tensorflow`.
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import argparse
import json
from pathlib import Path

import tensorflow as tf
import tensorflowjs as tfjs


def _strip_separable_conv2d_kernel_fields(model_json_path: Path) -> None:
    """Keras's SeparableConv2D.get_config() emits kernel_initializer/regularizer/
    constraint keys inherited from the base Conv layer, even though this layer
    type only uses the depthwise_*/pointwise_* variants. tfjs-layers' own
    SeparableConv2D deserializer rejects the mere presence of those keys — not
    just non-null values — with "Fields kernelInitializer, ... are invalid for
    SeparableConv2D" (confirmed 2026-09-11 by loading the export through
    @tensorflow/tfjs 4.22). This is independent of the Keras 2 vs 3 issue above;
    fix it at the same export boundary rather than downstream in JS."""
    data = json.loads(model_json_path.read_text())
    layers = data["modelTopology"]["model_config"]["config"]["layers"]
    for layer in layers:
        if layer["class_name"] == "SeparableConv2D":
            for key in ("kernel_initializer", "kernel_regularizer", "kernel_constraint"):
                layer["config"].pop(key, None)
    model_json_path.write_text(json.dumps(data))


def _assert_browser_compatible(model_json_path: Path) -> None:
    """Fail loudly instead of silently shipping an unloadable model.json.

    2026-09-11 burned a full day discovering (only by manually loading the
    export through the exact @tensorflow/tfjs version the browser uses) that
    Keras 3's output silently fails tf.loadLayersModel() with no error at
    export time at all — TF_USE_LEGACY_KERAS not taking effect (wrong shell,
    a future TF/Keras version dropping tf_keras, etc.) or a future model
    architecture change reintroducing the SeparableConv2D issue would repeat
    that exact failure mode with zero signal until someone opens a browser."""
    data = json.loads(model_json_path.read_text())
    keras_version = data["modelTopology"].get("keras_version", "")
    if not keras_version.startswith("2."):
        raise SystemExit(
            f"FAILED compatibility gate: model.json keras_version={keras_version!r}, expected 2.x "
            "(legacy Keras) — @tensorflow/tfjs 4.22 cannot load Keras 3's schema. "
            "Check TF_USE_LEGACY_KERAS=1 took effect before `import tensorflow`."
        )
    layers = data["modelTopology"]["model_config"]["config"]["layers"]
    for layer in layers:
        if layer["class_name"] == "InputLayer" and "batch_shape" in layer["config"]:
            raise SystemExit(
                "FAILED compatibility gate: InputLayer still has 'batch_shape' (Keras 3 key) instead "
                "of 'batch_input_shape' — tfjs-layers will reject this."
            )
        if layer["class_name"] == "SeparableConv2D":
            leftover = [k for k in ("kernel_initializer", "kernel_regularizer", "kernel_constraint") if k in layer["config"]]
            if leftover:
                raise SystemExit(
                    f"FAILED compatibility gate: SeparableConv2D layer {layer['name']!r} still has "
                    f"{leftover} — tfjs-layers rejects these keys outright. "
                    "_strip_separable_conv2d_kernel_fields() did not run or did not match this layer."
                )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True, help="model.keras from train.py")
    parser.add_argument("--out", type=Path, required=True, help="frontend public/models/wake-word")
    args = parser.parse_args()
    model = tf.keras.models.load_model(args.model)
    args.out.mkdir(parents=True, exist_ok=True)
    tfjs.converters.save_keras_model(model, str(args.out))
    _strip_separable_conv2d_kernel_fields(args.out / "model.json")
    _assert_browser_compatible(args.out / "model.json")
    size = sum(path.stat().st_size for path in args.out.rglob("*") if path.is_file())
    print(f"exported {size / 1024:.1f} KiB to {args.out}")
    if size > 200 * 1024:
        raise SystemExit("FAILED size gate: exported TF.js model exceeds 200 KiB")


if __name__ == "__main__":
    main()
