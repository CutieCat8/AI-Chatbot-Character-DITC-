"""Optional, offline Thai G2P adapter and IPA-to-DITC-viseme parser."""

from __future__ import annotations

import logging
import os
import re
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, Protocol

from app.config import settings

logger = logging.getLogger(__name__)

CatViseme = Literal["idle", "smile", "aa", "ee", "oh", "mbp", "fv", "s", "r", "wo"]
ExtendedPose = Literal["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"]


@dataclass(frozen=True)
class IpaPhone:
    symbol: str
    viseme: CatViseme
    pose: ExtendedPose
    syllable: int
    is_vowel: bool = False
    is_long: bool = False


class ThaiG2PProvider(Protocol):
    name: str

    def convert(self, text: str) -> str | None: ...


_THAI_RE = re.compile(r"[\u0E00-\u0E7F]")
_TONE_MARKS_RE = re.compile(r"[˥˦˧˨˩ꜛꜜ]+")
_IGNORED_IPA = frozenset(" /[]()|‿ˈˌ̯")
_MULTI_PHONES = (
    "t͡ɕʰ",
    "t͡ɕ",
    "d͡ʑ",
    "d͡ʒ",
    "t͡ʃ",
    "pʰ",
    "tʰ",
    "kʰ",
    "p̚",
    "t̚",
    "k̚",
)
_VOWELS = frozenset("aɑɐɛæeəɤɜiɪɯuʊoɔɒ")


def normalize_thai_text(text: str) -> str:
    """Stable cache key; FastThaiG2P still applies its own Thai normalizer."""
    return " ".join(unicodedata.normalize("NFC", text).split())


def contains_thai(text: str) -> bool:
    return bool(_THAI_RE.search(text))


def phonemize_thai_spans(text: str, provider: ThaiG2PProvider | None) -> list[dict[str, str]]:
    """Return development diagnostics without ever sending Latin spans to Thai G2P."""
    if provider is None:
        return []
    spans: list[dict[str, str]] = []
    for match in re.finditer(r"[\u0E00-\u0E7F]+", text):
        span = match.group()
        ipa = provider.convert(span)
        spans.append({"text": span, "ipa": ipa or "", "status": "thai-g2p" if ipa else "fallback"})
    return spans


def _phone_mapping(symbol: str) -> tuple[CatViseme, ExtendedPose, bool]:
    base = symbol.replace("ː", "").replace("̚", "").replace("ʰ", "")
    if base in {"p", "b", "m"}:
        return "mbp", "PP", False
    if base in {"f", "v"}:
        return "fv", "FF", False
    if base in {"θ", "ð"}:
        return "s", "TH", False
    if base in {"t", "d"}:
        return "s", "DD", False
    if base in {"k", "g"}:
        return "s", "kk", False
    if base in {"t͡ɕ", "d͡ʑ", "d͡ʒ", "t͡ʃ", "ɕ", "ʃ", "ʒ"}:
        return "s", "CH", False
    if base in {"s", "z"}:
        return "s", "SS", False
    if base in {"n", "ŋ", "ɲ"}:
        return "s", "nn", False
    if base in {"r", "ɾ", "l", "j", "h", "ʔ"}:
        return "r", "RR", False
    if base in {"a", "ɑ", "ɐ", "ɛ", "æ"}:
        return "aa", "aa", True
    if base in {"e", "ə", "ɤ", "ɜ"}:
        return "ee", "E", True
    if base in {"i", "ɪ", "ɯ"}:
        return "ee", "I", True
    if base in {"o", "ɔ", "ɒ"}:
        return "oh", "O", True
    if base in {"u", "ʊ", "w"}:
        return "wo", "U", base != "w"
    return "r", "RR", False


def parse_ipa(ipa: str) -> list[IpaPhone]:
    """Parse FastThaiG2P IPA, ignoring lexical tone while preserving articulation."""
    clean = _TONE_MARKS_RE.sub("", unicodedata.normalize("NFC", ipa))
    phones: list[IpaPhone] = []
    syllable = 0
    index = 0
    while index < len(clean):
        char = clean[index]
        if char == ".":
            syllable += 1
            index += 1
            continue
        if char in _IGNORED_IPA or char.isspace():
            index += 1
            continue

        symbol = next((item for item in _MULTI_PHONES if clean.startswith(item, index)), char)
        index += len(symbol)
        if symbol not in _MULTI_PHONES and index < len(clean) and clean[index] == "ː":
            symbol += "ː"
            index += 1
        # A non-syllabic mark is metadata on the preceding diphthong component.
        if index < len(clean) and clean[index] == "̯":
            index += 1

        viseme, pose, is_vowel = _phone_mapping(symbol)
        phones.append(
            IpaPhone(
                symbol=symbol,
                viseme=viseme,
                pose=pose,
                syllable=syllable,
                is_vowel=is_vowel,
                is_long="ː" in symbol,
            )
        )
    return phones


class FastThaiG2PProvider:
    """One process-wide engine with normalized-text cache and bounded calls."""

    name = "fastthaig2p-c4759eef"

    def __init__(self, timeout_ms: int) -> None:
        self._timeout_seconds = max(1, timeout_ms) / 1000
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="thai-g2p")
        self._lock = threading.Lock()
        self._engine = None

    def initialize(self) -> None:
        with self._lock:
            if self._engine is not None:
                return
            # These variables also exist in Dockerfile; setting defaults protects local runs.
            os.environ.setdefault("PYTHAINLP_DATA_DIR", settings.PYTHAINLP_DATA_DIR)
            os.environ.setdefault("PYTHAINLP_OFFLINE", "1")
            from fastthaig2p import G2P  # Imported only when the feature is enabled.

            self._engine = G2P()

    @lru_cache(maxsize=512)
    def _convert_cached(self, normalized_text: str) -> str:
        self.initialize()
        assert self._engine is not None
        return self._engine.convert(normalized_text)

    def convert(self, text: str) -> str | None:
        normalized = normalize_thai_text(text)
        if not normalized or not contains_thai(normalized):
            return None
        future = self._executor.submit(self._convert_cached, normalized)
        try:
            return future.result(timeout=self._timeout_seconds)
        except FutureTimeoutError:
            future.cancel()
            logger.warning("Thai G2P timed out after %d ms; using text fallback", settings.THAI_G2P_TIMEOUT_MS)
        except Exception:  # noqa: BLE001 - optional provider must never break speech
            logger.exception("Thai G2P failed; using text fallback")
        return None


_provider: FastThaiG2PProvider | None = None
_provider_lock = threading.Lock()


def get_thai_g2p_provider() -> ThaiG2PProvider | None:
    return _provider if settings.THAI_G2P_ENABLED else None


def warm_up_thai_g2p_provider() -> bool:
    """Initialize exactly once. Failure leaves the legacy timeline available."""
    global _provider
    if not settings.THAI_G2P_ENABLED:
        return False
    with _provider_lock:
        if _provider is None:
            candidate = FastThaiG2PProvider(settings.THAI_G2P_TIMEOUT_MS)
            try:
                candidate.initialize()
                if not candidate.convert("สวัสดี"):
                    raise RuntimeError("FastThaiG2P warm-up returned no IPA")
            except Exception:  # noqa: BLE001
                logger.exception("Thai G2P warm-up failed; feature remains on legacy fallback")
                return False
            _provider = candidate
    logger.info("Thai G2P ready: %s (offline)", _provider.name)
    return True
