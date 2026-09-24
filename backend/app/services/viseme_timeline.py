"""Text-driven viseme fallback for Gemini Live native-audio responses.

Gemini Live does not expose phoneme/viseme alignment.  This module converts the
incremental output transcript into coarse syllable/word cues, then stretches the
cues over the real PCM duration received for the turn.  It deliberately never
uses amplitude to choose a mouth shape.
"""

from __future__ import annotations

import re
from typing import Literal, NotRequired, TypedDict

from app.services.thai_g2p import ExtendedPose, ThaiG2PProvider, parse_ipa

CatViseme = Literal["idle", "smile", "aa", "ee", "oh", "mbp", "fv", "s", "r", "wo"]


class VisemeCue(TypedDict):
    startMs: int
    endMs: int
    viseme: CatViseme
    text: str
    pose: NotRequired[ExtendedPose]


class TimedWord(TypedDict):
    word: str
    startMs: int
    endMs: int


_THAI_RE = re.compile(r"[\u0E00-\u0E7F]")
_TOKEN_RE = re.compile(r"[A-Za-z']+|[\u0E00-\u0E7F]+|[.,!?;:]+")
_EN_VOWELS = re.compile(r"(?:oo|ou|ow|oa|aw|au|ee|ea|ie|ai|ay|ei|ey|oi|oy|[aeiouy])", re.I)
_THAI_SYLLABLE = re.compile(
    r"(?:[เแโใไ])?(?:[ก-ฮ]{1,2})(?:[ะาิีึืุูั็]*)?(?:[ก-ฮ]์?)?",
)


def _language(text: str) -> str:
    return "th" if _THAI_RE.search(text) else "en"


def _english_vowel_viseme(group: str) -> CatViseme:
    value = group.lower()
    if value in {"o", "oa", "aw", "au", "oi", "oy"}:
        return "oh"
    if value in {"u", "oo", "ou", "ow"}:
        return "wo"
    if value in {"e", "ee", "ea", "i", "ie", "y", "ai", "ay", "ei", "ey"}:
        return "ee"
    return "aa"


def _thai_vowel_viseme(syllable: str) -> CatViseme:
    # Ordered multi-character vowel patterns; this operates on a syllable unit,
    # not one Thai character at a time.
    if re.search(r"(?:โ|อ[อ]|เ[อ]|[เแ].*าะ)", syllable):
        return "oh"
    if re.search(r"(?:ู|ุ|ว)", syllable):
        return "wo"
    if re.search(r"(?:ิ|ี|เ|แ)", syllable):
        return "ee"
    return "aa"


def _onset_viseme(unit: str, language: str) -> CatViseme | None:
    value = unit.lower()
    if language == "en":
        if re.match(r"(?:m|b|p)", value):
            return "mbp"
        if re.match(r"(?:f|v)", value):
            return "fv"
        if re.match(r"(?:s|z|sh|ch|j)", value):
            return "s"
        if re.match(r"w", value):
            return "wo"
        return None
    if re.search(r"^[เแโใไ]?[มบปพภผ]", unit):
        return "mbp"
    if re.search(r"^[เแโใไ]?[ฟฝ]", unit):
        return "fv"
    if re.search(r"^[เแโใไ]?[สศษซชฌจฉ]", unit):
        return "s"
    if re.search(r"^[เแโใไ]?ว", unit):
        return "wo"
    return None


def _weighted_cues(text: str) -> list[tuple[CatViseme, int, str]]:
    cues: list[tuple[CatViseme, int, str]] = []
    for token in _TOKEN_RE.findall(text):
        if re.fullmatch(r"[.,!?;:]+", token):
            cues.append(("idle", 70, token))
            continue

        language = _language(token)
        if language == "en":
            matches = list(_EN_VOWELS.finditer(token))
            units = [token] if not matches else [token[max(0, m.start() - 2) : m.end() + 2] for m in matches]
            if not matches:
                onset = _onset_viseme(token, language)
                cues.append((onset or "r", 90, token))
                continue
            for index, match in enumerate(matches):
                unit = units[index]
                onset = _onset_viseme(unit, language)
                if onset:
                    cues.append((onset, 65, unit))
                cues.append((_english_vowel_viseme(match.group()), 145, unit))
        else:
            units = _THAI_SYLLABLE.findall(token) or [token]
            for unit in units:
                onset = _onset_viseme(unit, language)
                if onset:
                    cues.append((onset, 65, unit))
                cues.append((_thai_vowel_viseme(unit), 145, unit))
    return cues or [("r", 120, text)]


def _g2p_weighted_cues(
    text: str,
    provider: ThaiG2PProvider | None,
) -> list[tuple[CatViseme, int, str, ExtendedPose | None]]:
    """Use Thai IPA only for Thai spans; preserve the established English path."""
    output: list[tuple[CatViseme, int, str, ExtendedPose | None]] = []
    for token in _TOKEN_RE.findall(text):
        if re.fullmatch(r"[.,!?;:]+", token):
            output.append(("idle", 70, token, "sil"))
            continue
        if _language(token) == "en":
            output.extend((*cue, None) for cue in _weighted_cues(token))
            continue
        ipa = provider.convert(token) if provider is not None else None
        phones = parse_ipa(ipa) if ipa else []
        if not phones:
            output.extend((*cue, None) for cue in _weighted_cues(token))
            continue
        for phone in phones:
            if phone.is_vowel:
                weight = 190 if phone.is_long else 145
            elif phone.pose in {"PP", "FF"}:
                weight = 55
            else:
                weight = 60
            output.append((phone.viseme, weight, phone.symbol, phone.pose))
    return output or [("r", 120, text, None)]


def _merge_adjacent(cues: list[VisemeCue]) -> list[VisemeCue]:
    merged: list[VisemeCue] = []
    for cue in cues:
        if (
            merged
            and merged[-1]["viseme"] == cue["viseme"]
            and merged[-1].get("pose") == cue.get("pose")
            and merged[-1]["endMs"] == cue["startMs"]
        ):
            merged[-1]["endMs"] = cue["endMs"]
            merged[-1]["text"] += cue["text"]
        else:
            merged.append(cue.copy())
    return merged


def build_viseme_timeline(
    text: str,
    duration_ms: int,
    thai_g2p_provider: ThaiG2PProvider | None = None,
) -> list[VisemeCue]:
    """Build sequential cues scaled to real received PCM duration."""
    weighted = _g2p_weighted_cues(text.strip(), thai_g2p_provider)
    if not weighted or duration_ms <= 0:
        return []

    total_weight = sum(weight for _, weight, _, _ in weighted)
    cursor = 0
    cues: list[VisemeCue] = []
    for index, (viseme, weight, source_text, pose) in enumerate(weighted):
        end = duration_ms if index == len(weighted) - 1 else round(cursor + duration_ms * weight / total_weight)
        if end - cursor < 35 and cues:
            cues[-1]["endMs"] = end
            cues[-1]["text"] += source_text
        else:
            cue: VisemeCue = {"startMs": cursor, "endMs": end, "viseme": viseme, "text": source_text}
            if pose is not None:
                cue["pose"] = pose
            cues.append(cue)
        cursor = end
    return _merge_adjacent(cues)


def build_word_aligned_viseme_timeline(
    words: list[TimedWord],
    duration_ms: int,
    thai_g2p_provider: ThaiG2PProvider | None = None,
) -> list[VisemeCue]:
    """Use provider word boundaries, distributing text-driven cues only inside each word."""
    output: list[VisemeCue] = []
    cursor = 0
    for item in sorted(words, key=lambda value: value["startMs"]):
        start = max(cursor, item["startMs"])
        end = min(duration_ms, max(start, item["endMs"]))
        if start > cursor:
            output.append({"startMs": cursor, "endMs": start, "viseme": "idle", "text": ""})
        if end <= start:
            continue
        for cue in build_viseme_timeline(item["word"], end - start, thai_g2p_provider):
            output.append(
                {
                    **cue,
                    "startMs": cue["startMs"] + start,
                    "endMs": cue["endMs"] + start,
                }
            )
        cursor = end
    if cursor < duration_ms:
        output.append({"startMs": cursor, "endMs": duration_ms, "viseme": "idle", "text": ""})
    return _merge_adjacent(output)

def summarize_viseme_timeline(cues: list[VisemeCue]) -> dict[str, object]:
    """Stable A/B metrics for development telemetry; idle is excluded from ratios."""
    if not cues:
        return {"cueChangesPerSecond": 0.0, "visemeRatios": {}, "durationMs": 0}
    duration_ms = max(cue["endMs"] for cue in cues)
    speech = [cue for cue in cues if cue["viseme"] != "idle"]
    speech_ms = sum(cue["endMs"] - cue["startMs"] for cue in speech)
    durations: dict[str, int] = {}
    for cue in speech:
        durations[cue["viseme"]] = durations.get(cue["viseme"], 0) + cue["endMs"] - cue["startMs"]
    changes = sum(a["viseme"] != b["viseme"] for a, b in zip(speech, speech[1:]))
    return {
        "cueChangesPerSecond": round(changes / max(duration_ms / 1000, 0.001), 3),
        "visemeRatios": {
            viseme: round(value / max(speech_ms, 1), 4)
            for viseme, value in sorted(durations.items())
        },
        "durationMs": duration_ms,
    }
