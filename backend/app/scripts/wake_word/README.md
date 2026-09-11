# Wake-word training pipeline

This directory trains the local browser classifier for `สวัสดี ditc`.
The dataset is synthetic edge-tts audio only; a successful synthetic result is
not evidence that real speakers work. Do not deploy before the tablet test in
the design spec.

```bash
python3 -m venv .venv
.venv/bin/pip install "tensorflow==2.16.2" tensorflowjs edge-tts soundfile scipy
.venv/bin/python generate_dataset.py --out /private/tmp/wake-word-dataset
.venv/bin/python train.py --dataset /private/tmp/wake-word-dataset --out /private/tmp/wake-word-training
.venv/bin/python export_tfjs.py --model /private/tmp/wake-word-training/model.keras --out ../../../../frontend-character/public/models/wake-word
```

`train.py` is fail-closed: it exits unsuccessfully unless held-out data has no
false accepts, precision is at least 0.95, and recall is at least 0.50. Only
run `export_tfjs.py` after that gate passes. `generate_dataset.py` resumes
valid cached TTS files and retries transient failed responses.

For real-speaker samples, open the character app with `?wakeword=1`, use the
"เก็บเสียงสำหรับเทรน" panel, and download the generated WAV files. Put them
under `positive/` or `negative/` in a copy of the dataset before running
`train.py`. Record at least 30 examples of each target pronunciation and many
more negatives, especially ordinary `สวัสดี` greetings.
