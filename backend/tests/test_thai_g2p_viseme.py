import pytest

from app.services.thai_g2p import parse_ipa, phonemize_thai_spans
from app.services.viseme_timeline import (
    build_viseme_timeline,
    build_word_aligned_viseme_timeline,
    summarize_viseme_timeline,
)


SAMPLES = {
    "มา": "/maː˧/",
    "บา": "/baː˧/",
    "ปา": "/paː˧/",
    "ฟ้า": "/faː˦˥/",
    "ว่า": "/waː˥˩/",
    "สี": "/siː˩˩˦/",
    "ชีวิต": "/t͡ɕʰiː˧.wit̚˦˥/",
    "รัก": "/rak̚˦˥/",
    "เรา": "/raw˧/",
    "โอเค": "/ʔoː˧.kʰeː˧/",
    "อยู่": "/juː˨˩/",
    "สวัสดีครับ": "/sa˨˩.wat̚˨˩.diː˧/ /kʰrap̚˦˥/",
    "มหาวิทยาลัยเชียงใหม่": "/ma˦˥.haː˩˩˦.wit̚˦˥.tʰa˦˥.jaː˧.laj˧.t͡ɕʰia̯ŋ˧.maj˨˩/",
}


class FakeProvider:
    name = "test"

    def __init__(self, samples: dict[str, str | None] | None = None) -> None:
        self.samples = samples or SAMPLES
        self.calls: list[str] = []

    def convert(self, text: str) -> str | None:
        self.calls.append(text)
        return self.samples.get(text)


@pytest.mark.parametrize("word,ipa", SAMPLES.items())
def test_feasibility_words_map_from_ipa(word: str, ipa: str):
    provider = FakeProvider()
    cues = build_viseme_timeline(word, 1_000, provider)
    assert cues[0]["startMs"] == 0
    assert cues[-1]["endMs"] == 1_000
    assert all(cue.get("pose") for cue in cues)
    expected = {phone.viseme for phone in parse_ipa(ipa)}
    assert {cue["viseme"] for cue in cues} <= expected


def test_ipa_parser_supports_requested_thai_features():
    phones = parse_ipa("/pʰaː˥.t͡ɕʰia̯ŋ.t̚.k̚.ʔuː/")
    symbols = [phone.symbol for phone in phones]
    assert "pʰ" in symbols
    assert "aː" in symbols
    assert "t͡ɕʰ" in symbols
    assert "t̚" in symbols and "k̚" in symbols
    assert "ʔ" in symbols
    assert not any(symbol in "˥˦˧˨˩" for symbol in symbols)
    assert max(phone.syllable for phone in phones) >= 3


def test_vowels_get_more_time_than_consonant_closures():
    cues = build_viseme_timeline("ปา", 600, FakeProvider())
    mbp = next(cue for cue in cues if cue["viseme"] == "mbp")
    vowel = next(cue for cue in cues if cue["viseme"] == "aa")
    assert vowel["endMs"] - vowel["startMs"] > mbp["endMs"] - mbp["startMs"]


def test_adjacent_same_ipa_pose_is_merged():
    provider = FakeProvider({"ทดสอบ": "/aː.aː/"})
    cues = build_viseme_timeline("ทดสอบ", 500, provider)
    assert cues == [{"startMs": 0, "endMs": 500, "viseme": "aa", "text": "aːaː", "pose": "aa"}]


def test_failed_g2p_falls_back_to_legacy_thai_timeline():
    provider = FakeProvider({"สวัสดี": None})
    cues = build_viseme_timeline("สวัสดี", 800, provider)
    assert cues
    assert all("pose" not in cue for cue in cues)


def test_mixed_thai_english_never_sends_english_to_provider():
    provider = FakeProvider({"สวัสดี": SAMPLES["สวัสดีครับ"].split()[0]})
    cues = build_viseme_timeline("สวัสดี DITC Cat", 1_200, provider)
    assert provider.calls == ["สวัสดี"]
    assert cues[-1]["endMs"] == 1_200


def test_word_timestamps_remain_the_outer_alignment_boundary():
    provider = FakeProvider()
    cues = build_word_aligned_viseme_timeline(
        [{"word": "มา", "startMs": 100, "endMs": 500}],
        700,
        provider,
    )
    spoken = [cue for cue in cues if cue["viseme"] != "idle"]
    assert spoken[0]["startMs"] == 100
    assert spoken[-1]["endMs"] == 500

def test_debug_phonemizer_never_sends_latin_spans_to_thai_provider():
    provider = FakeProvider({"วันนี้": "/wan.niː/"})
    spans = phonemize_thai_spans("วันนี้ CAMT Innovation Lab", provider)
    assert provider.calls == ["วันนี้"]
    assert spans == [{"text": "วันนี้", "ipa": "/wan.niː/", "status": "thai-g2p"}]


def test_timeline_summary_reports_changes_and_non_idle_ratios():
    metrics = summarize_viseme_timeline(
        [
            {"startMs": 0, "endMs": 100, "viseme": "idle", "text": ""},
            {"startMs": 100, "endMs": 300, "viseme": "mbp", "text": "m"},
            {"startMs": 300, "endMs": 700, "viseme": "aa", "text": "a"},
        ]
    )
    assert metrics["cueChangesPerSecond"] == pytest.approx(1 / 0.7, abs=0.001)
    assert metrics["visemeRatios"] == {"aa": pytest.approx(2 / 3, abs=0.0001), "mbp": pytest.approx(1 / 3, abs=0.0001)}
