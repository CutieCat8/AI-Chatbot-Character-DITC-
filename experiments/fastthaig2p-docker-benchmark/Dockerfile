FROM ditc-fastthaig2p-benchmark:baseline

ENV PYTHAINLP_DATA_DIR=/tmp/pythainlp-data \
    PYTHAINLP_OFFLINE=1

RUN pip install --no-cache-dir \
    "fastthaig2p @ https://github.com/awslabs/FastThaiG2P/archive/c4759eef7df03e11fcbb9aa83efe8cf21709fd2f.zip" \
    && mkdir -p /tmp/pythainlp-data

COPY benchmark.py /benchmark.py

ENTRYPOINT ["python", "/benchmark.py"]
