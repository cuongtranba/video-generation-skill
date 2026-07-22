package tts

import (
	"strings"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
)

// elevenLabsAlignment is the character-level timing block returned by the
// ElevenLabs /with-timestamps endpoint. All three slices are parallel.
type elevenLabsAlignment struct {
	Characters                 []string  `json:"characters"`
	CharacterStartTimesSeconds []float64 `json:"character_start_times_seconds"`
	CharacterEndTimesSeconds   []float64 `json:"character_end_times_seconds"`
}

// wordsFromAlignment groups consecutive non-whitespace characters into words.
// A word's start is its first character's start time and its end is its last
// character's end time; whitespace characters are separators only. Returns nil
// when the alignment is nil, empty, or has inconsistent slice lengths (the
// caller then writes no sidecar and captions fail loudly rather than drift).
func wordsFromAlignment(a *elevenLabsAlignment) []caption.WordTimestamp {
	if a == nil {
		return nil
	}
	n := len(a.Characters)
	if n == 0 || len(a.CharacterStartTimesSeconds) != n || len(a.CharacterEndTimesSeconds) != n {
		return nil
	}
	var words []caption.WordTimestamp
	var cur strings.Builder
	var start, end float64
	inWord := false
	flush := func() {
		if inWord && cur.Len() > 0 {
			words = append(words, caption.WordTimestamp{Word: cur.String(), Start: start, End: end})
		}
		cur.Reset()
		inWord = false
	}
	for i, ch := range a.Characters {
		if strings.TrimSpace(ch) == "" {
			flush()
			continue
		}
		if !inWord {
			start = a.CharacterStartTimesSeconds[i]
			inWord = true
		}
		cur.WriteString(ch)
		end = a.CharacterEndTimesSeconds[i]
	}
	flush()
	return words
}
