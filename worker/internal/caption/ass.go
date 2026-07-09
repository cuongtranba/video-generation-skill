package caption

import (
	"fmt"
	"os"
	"strings"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
)

const wordsPerLine = 4

type ASSWriter struct{}

func NewASSWriter() *ASSWriter {
	return &ASSWriter{}
}

// Write renders word timestamps as an ASS karaoke subtitle file sized for a
// 1080x1920 vertical video.
func (a *ASSWriter) Write(words []WordTimestamp, style domain.CaptionStyle, destPath string) error {
	if len(words) == 0 {
		return fmt.Errorf("no words to write to %s", destPath)
	}

	fontName := style.FontName
	if fontName == "" {
		fontName = "Arial"
	}
	fontSize := style.FontSize
	if fontSize == 0 {
		fontSize = 64
	}
	bold := 0
	if style.Bold {
		bold = -1
	}

	var b strings.Builder
	fmt.Fprintf(&b, `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,%s,%d,%s,&H00FFFF00,%s,&H80000000,%d,0,0,0,100,100,0,0,1,3,1,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`, fontName, fontSize, hexToASS(style.Primary, "&H00FFFFFF"), hexToASS(style.Outline, "&H00000000"), bold)

	for _, line := range groupWords(words, wordsPerLine) {
		start := line[0].Start
		end := line[len(line)-1].End

		var text strings.Builder
		for i, w := range line {
			durCs := int((w.End - w.Start) * 100)
			if durCs < 1 {
				durCs = 1
			}
			if i > 0 {
				text.WriteString(" ")
			}
			fmt.Fprintf(&text, `{\k%d}%s`, durCs, w.Word)
		}
		fmt.Fprintf(&b, "Dialogue: 0,%s,%s,Caption,,0,0,0,,%s\n", assTime(start), assTime(end), text.String())
	}

	if err := os.WriteFile(destPath, []byte(b.String()), 0o644); err != nil {
		return fmt.Errorf("write ASS file %s: %w", destPath, err)
	}
	return nil
}

// maxWordGapSec splits a caption line when consecutive words are separated by
// silence (e.g. a scene boundary), keeping karaoke timing in sync.
const maxWordGapSec = 0.8

func groupWords(words []WordTimestamp, perLine int) [][]WordTimestamp {
	var lines [][]WordTimestamp
	var current []WordTimestamp
	for _, w := range words {
		gapBreak := len(current) > 0 && w.Start-current[len(current)-1].End > maxWordGapSec
		if len(current) == perLine || gapBreak {
			lines = append(lines, current)
			current = nil
		}
		current = append(current, w)
	}
	if len(current) > 0 {
		lines = append(lines, current)
	}
	return lines
}

// assTime formats seconds as H:MM:SS.CC.
func assTime(sec float64) string {
	cs := int(sec*100 + 0.5)
	h := cs / 360000
	cs %= 360000
	m := cs / 6000
	cs %= 6000
	s := cs / 100
	cs %= 100
	return fmt.Sprintf("%d:%02d:%02d.%02d", h, m, s, cs)
}

// hexToASS converts "#RRGGBB" to ASS "&H00BBGGRR" format.
func hexToASS(hex, fallback string) string {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) != 6 {
		return fallback
	}
	r, g, b := hex[0:2], hex[2:4], hex[4:6]
	return "&H00" + strings.ToUpper(b+g+r)
}
