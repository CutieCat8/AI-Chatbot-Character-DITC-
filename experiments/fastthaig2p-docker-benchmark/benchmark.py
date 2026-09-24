from __future__ import annotations

import json
import os
from pathlib import Path
import resource
import sys
import time

sys.path.insert(0, "/app")


def rss_mib() -> float:
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return round(int(line.split()[1]) / 1024, 3)
    raise RuntimeError("VmRSS is unavailable")


network_events: list[str] = []


def audit_network(event: str, _args: tuple[object, ...]) -> None:
    if event in {"socket.connect", "socket.getaddrinfo", "socket.gethostbyaddr"}:
        network_events.append(event)


sys.addaudithook(audit_network)

mode = os.environ.get("BENCHMARK_MODE", "baseline")
data_dir = Path(os.environ["PYTHAINLP_DATA_DIR"])
before_files = sorted(str(path.relative_to(data_dir)) for path in data_dir.rglob("*") if path.is_file())

app_started = time.perf_counter()
import app.main  # noqa: E402,F401

app_import_ms = (time.perf_counter() - app_started) * 1000
result: dict[str, object] = {
    "mode": mode,
    "appImportMs": round(app_import_ms, 3),
    "rssAfterAppImportMiB": rss_mib(),
}

if mode == "g2p":
    import_started = time.perf_counter()
    from fastthaig2p import G2P

    import_ms = (time.perf_counter() - import_started) * 1000
    init_started = time.perf_counter()
    provider = G2P()
    init_ms = (time.perf_counter() - init_started) * 1000

    messages = [
        "มา",
        "บา",
        "ปา",
        "ฟ้า",
        "ว่า",
        "สี",
        "ชีวิต",
        "รัก",
        "เรา",
        "โอเค",
        "อยู่",
        "สวัสดีครับ",
        "มหาวิทยาลัยเชียงใหม่",
        "สวัสดี DITC Cat welcome to Chiang Mai University",
    ]
    outputs = {message: provider.convert(message) for message in messages}
    iterations = 100
    warm_started = time.perf_counter()
    for _ in range(iterations):
        for message in messages:
            provider.convert(message)
    warm_elapsed_ms = (time.perf_counter() - warm_started) * 1000

    result.update(
        {
            "fastThaiG2PImportMs": round(import_ms, 3),
            "g2pInitMs": round(init_ms, 3),
            "totalInitializationMs": round(import_ms + init_ms, 3),
            "warmMeanMsPerMessage": round(warm_elapsed_ms / (iterations * len(messages)), 6),
            "rssAfterG2PInitMiB": rss_mib(),
            "outputs": outputs,
        }
    )

after_files = sorted(str(path.relative_to(data_dir)) for path in data_dir.rglob("*") if path.is_file())
result.update(
    {
        "peakRssMiB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 3),
        "networkAuditEvents": network_events,
        "dataFilesBefore": before_files,
        "dataFilesAfter": after_files,
        "pyThaiNlpOffline": os.environ.get("PYTHAINLP_OFFLINE"),
        "pyThaiNlpDataDir": str(data_dir),
    }
)

print(json.dumps(result, ensure_ascii=False, sort_keys=True))
