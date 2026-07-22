package caption

import "strings"

// WordTimestamp is one caption token with its start/end time in seconds,
// relative to the audio it was derived from. The json tags match the sidecar
// file format written by the tts package.
type WordTimestamp struct {
	Word  string  `json:"word"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// AlignNarration replaces the transcript text with the authoritative narration
// while keeping the transcriber's timing, so captions never inherit TTS
// pronunciation errors. When the narration word count matches the transcript
// word count each narration word takes the matching timestamp (word-accurate
// karaoke). Otherwise the narration words are spread evenly across the
// transcript's time span (correct text, approximate timing).
func AlignNarration(narration string, timed []WordTimestamp) []WordTimestamp {
	narr := strings.Fields(narration)
	if len(narr) == 0 || len(timed) == 0 {
		// Nothing authoritative to substitute (or no timing to hang it on):
		// keep whatever the transcriber produced.
		return timed
	}

	if len(narr) == len(timed) {
		out := make([]WordTimestamp, len(timed))
		for i := range timed {
			out[i] = WordTimestamp{Word: narr[i], Start: timed[i].Start, End: timed[i].End}
		}
		return out
	}

	start := timed[0].Start
	end := timed[len(timed)-1].End
	span := end - start
	if span <= 0 {
		// Degenerate timing span; fall back to a nominal 0.3s per word.
		span = 0.3 * float64(len(narr))
		end = start + span
	}
	per := span / float64(len(narr))
	out := make([]WordTimestamp, len(narr))
	for i, w := range narr {
		out[i] = WordTimestamp{Word: w, Start: start + per*float64(i), End: start + per*float64(i+1)}
	}
	return out
}
