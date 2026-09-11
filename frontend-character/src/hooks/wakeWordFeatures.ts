import * as tf from "@tensorflow/tfjs";

// These constants are part of the model contract. Keep them identical to
// backend/app/scripts/wake_word/train.py.
export const WAKE_WORD_SAMPLE_RATE = 16_000;
export const WAKE_WORD_SAMPLES = 32_000; // 2.0 s (เดิม 25_600 / 1.6s — ปรับ 2026-09-11)
export const FRAME_LENGTH = 640;
export const FRAME_STEP = 320;
export const FFT_LENGTH = 1024;
export const MEL_BINS = 40;
export const LOWER_HZ = 80;
export const UPPER_HZ = 7_600;

// TensorFlow.js does not expose Python's linear_to_mel_weight_matrix. This is
// its triangular HTK-mel construction (mel = 1127 * ln(1 + Hz / 700)).
function melWeightMatrix(): tf.Tensor2D {
  const hzToMel = (hz: number) => 1127 * Math.log(1 + hz / 700);
  const melToHz = (mel: number) => 700 * (Math.exp(mel / 1127) - 1);
  const edgeMels = Array.from({ length: MEL_BINS + 2 }, (_, i) =>
    hzToMel(LOWER_HZ) + (i * (hzToMel(UPPER_HZ) - hzToMel(LOWER_HZ))) / (MEL_BINS + 1),
  );
  const edges = edgeMels.map(melToHz);
  const values = new Float32Array((FFT_LENGTH / 2 + 1) * MEL_BINS);
  for (let bin = 0; bin <= FFT_LENGTH / 2; bin++) {
    const hz = (bin * WAKE_WORD_SAMPLE_RATE) / FFT_LENGTH;
    for (let mel = 0; mel < MEL_BINS; mel++) {
      const rising = (hz - edges[mel]) / (edges[mel + 1] - edges[mel]);
      const falling = (edges[mel + 2] - hz) / (edges[mel + 2] - edges[mel + 1]);
      values[bin * MEL_BINS + mel] = Math.max(0, Math.min(rising, falling));
    }
  }
  return tf.tensor2d(values, [FFT_LENGTH / 2 + 1, MEL_BINS]);
}

/** Convert a fixed 2.0 s PCM window into the [1, 99, 40, 1] model input. */
export function logMelTensor(samples: Float32Array): tf.Tensor4D {
  if (samples.length !== WAKE_WORD_SAMPLES) {
    throw new Error(`Expected ${WAKE_WORD_SAMPLES} samples, received ${samples.length}`);
  }
  return tf.tidy(() => {
    const wave = tf.tensor1d(samples);
    const stft = tf.signal.stft(wave, FRAME_LENGTH, FRAME_STEP, FFT_LENGTH, tf.signal.hannWindow);
    const power = tf.square(tf.abs(stft));
    const melMatrix = melWeightMatrix();
    const mel = tf.matMul(power, melMatrix);
    return tf.expandDims(tf.expandDims(tf.log(tf.maximum(mel, 1e-6)), 0), -1) as tf.Tensor4D;
  });
}

/** Linear resampling is adequate here because getUserMedia normally supplies 48 kHz. */
export function resampleToWakeWordRate(input: Float32Array, inputRate: number): Float32Array {
  const output = new Float32Array(WAKE_WORD_SAMPLES);
  const ratio = inputRate / WAKE_WORD_SAMPLE_RATE;
  for (let i = 0; i < output.length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = input[Math.min(left, input.length - 1)] ?? 0;
    const b = input[Math.min(left + 1, input.length - 1)] ?? 0;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}
