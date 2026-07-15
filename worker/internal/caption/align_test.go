package caption

import "testing"

func TestAlignNarrationExactCountKeepsTimings(t *testing.T) {
	timed := []WordTimestamp{
		{Word: "troi", Start: 0.0, End: 0.4},
		{Word: "oi", Start: 0.4, End: 0.9},
		{Word: "cuoc", Start: 0.9, End: 1.5},
	}
	got := AlignNarration("Trời ơi cuộc", timed)
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	want := []string{"Trời", "ơi", "cuộc"}
	for i, w := range want {
		if got[i].Word != w {
			t.Errorf("word[%d] = %q, want %q", i, got[i].Word, w)
		}
		if got[i].Start != timed[i].Start || got[i].End != timed[i].End {
			t.Errorf("timing[%d] = (%v,%v), want (%v,%v)", i, got[i].Start, got[i].End, timed[i].Start, timed[i].End)
		}
	}
}

func TestAlignNarrationMismatchSpreadsEvenly(t *testing.T) {
	// whisper heard 2 garbled words spanning 0..2s; narration has 4 words.
	timed := []WordTimestamp{{Word: "x", Start: 0, End: 1}, {Word: "y", Start: 1, End: 2}}
	got := AlignNarration("một hai ba bốn", timed)
	if len(got) != 4 {
		t.Fatalf("len = %d, want 4 (narration word count)", len(got))
	}
	if got[0].Word != "một" || got[3].Word != "bốn" {
		t.Errorf("text not from narration: %q..%q", got[0].Word, got[3].Word)
	}
	if got[0].Start != 0 {
		t.Errorf("first start = %v, want 0", got[0].Start)
	}
	if got[3].End != 2 {
		t.Errorf("last end = %v, want 2 (whisper span)", got[3].End)
	}
}

func TestAlignNarrationEmptyFallsBackToTimed(t *testing.T) {
	timed := []WordTimestamp{{Word: "keep", Start: 0, End: 1}}
	if got := AlignNarration("", timed); len(got) != 1 || got[0].Word != "keep" {
		t.Errorf("empty narration should keep whisper words, got %+v", got)
	}
	if got := AlignNarration("text", nil); got != nil {
		t.Errorf("no timings should return nil, got %+v", got)
	}
}
