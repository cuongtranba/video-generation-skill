package tts

import "testing"

func TestWordsFromAlignmentGroupsByWhitespace(t *testing.T) {
	a := &elevenLabsAlignment{
		Characters:                 []string{"X", "i", "n", " ", "c", "h", "à", "o"},
		CharacterStartTimesSeconds: []float64{0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7},
		CharacterEndTimesSeconds:   []float64{0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8},
	}
	got := wordsFromAlignment(a)
	if len(got) != 2 {
		t.Fatalf("want 2 words, got %d (%+v)", len(got), got)
	}
	if got[0].Word != "Xin" || got[0].Start != 0.0 || got[0].End != 0.3 {
		t.Errorf("word0 = %+v, want {Xin 0 0.3}", got[0])
	}
	if got[1].Word != "chào" || got[1].Start != 0.4 || got[1].End != 0.8 {
		t.Errorf("word1 = %+v, want {chào 0.4 0.8}", got[1])
	}
}

func TestWordsFromAlignmentHandlesRunsAndEdges(t *testing.T) {
	a := &elevenLabsAlignment{
		Characters:                 []string{" ", "a", " ", " ", "b", " "},
		CharacterStartTimesSeconds: []float64{0, 1, 2, 3, 4, 5},
		CharacterEndTimesSeconds:   []float64{1, 2, 3, 4, 5, 6},
	}
	got := wordsFromAlignment(a)
	if len(got) != 2 || got[0].Word != "a" || got[1].Word != "b" {
		t.Fatalf("want [a b], got %+v", got)
	}
	if got[0].Start != 1 || got[0].End != 2 || got[1].Start != 4 || got[1].End != 5 {
		t.Errorf("edge timings wrong: %+v", got)
	}
}

func TestWordsFromAlignmentEmptyOrMismatched(t *testing.T) {
	if got := wordsFromAlignment(nil); got != nil {
		t.Errorf("nil alignment -> %+v, want nil", got)
	}
	if got := wordsFromAlignment(&elevenLabsAlignment{}); got != nil {
		t.Errorf("empty alignment -> %+v, want nil", got)
	}
	bad := &elevenLabsAlignment{
		Characters:                 []string{"a", "b"},
		CharacterStartTimesSeconds: []float64{0},
		CharacterEndTimesSeconds:   []float64{1},
	}
	if got := wordsFromAlignment(bad); got != nil {
		t.Errorf("mismatched lengths -> %+v, want nil", got)
	}
}
