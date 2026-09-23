from app.services.viseme_timeline import build_viseme_timeline, build_word_aligned_viseme_timeline


def _assert_valid(text: str) -> list[dict]:
    cues = build_viseme_timeline(text, 4_000)
    assert cues
    assert cues[0]["startMs"] == 0
    assert cues[-1]["endMs"] == 4_000
    assert all(a["endMs"] == b["startMs"] for a, b in zip(cues, cues[1:]))
    assert all(a["viseme"] != b["viseme"] for a, b in zip(cues, cues[1:]))
    return cues


def test_thai_sentence_builds_syllable_timeline():
    cues = _assert_valid("สวัสดีครับ ยินดีต้อนรับสู่ DITC มีอะไรให้ผมช่วยไหมครับ")
    assert {cue["viseme"] for cue in cues} & {"aa", "ee", "mbp", "s", "wo"}


def test_english_sentence_builds_word_timeline():
    cues = _assert_valid("Hello, welcome to DITC. How can I help you today?")
    assert {cue["viseme"] for cue in cues} & {"aa", "ee", "oh", "mbp", "wo"}


def test_oh_is_text_driven_not_duration_driven():
    without_o = build_viseme_timeline("see me", 1_000)
    assert "oh" not in {cue["viseme"] for cue in without_o}
    assert "oh" in {cue["viseme"] for cue in build_viseme_timeline("open", 1_000)}


def test_adjacent_same_visemes_are_merged():
    cues = build_viseme_timeline("aaaa", 800)
    assert all(a["viseme"] != b["viseme"] for a, b in zip(cues, cues[1:]))


def test_provider_word_boundaries_are_preserved():
    cues = build_word_aligned_viseme_timeline(
        [
            {"word": "Hello", "startMs": 100, "endMs": 500},
            {"word": "you", "startMs": 700, "endMs": 1_000},
        ],
        1_100,
    )
    assert cues[0] == {"startMs": 0, "endMs": 100, "viseme": "idle", "text": ""}
    assert any(cue["startMs"] == 500 and cue["endMs"] == 700 and cue["viseme"] == "idle" for cue in cues)
    assert cues[-1] == {"startMs": 1_000, "endMs": 1_100, "viseme": "idle", "text": ""}
