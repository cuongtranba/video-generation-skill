package render

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	outWidth  = 1080
	outHeight = 1920
	outFPS    = 30
)

type SceneInput struct {
	MediaPath   string
	AudioPath   string
	IsImage     bool
	DurationSec float64
	// MediaDurationSec is the source clip's own length; when shorter than
	// DurationSec the input is looped so the scene never runs out of video.
	MediaDurationSec float64
}

// FilterGraph is a fully assembled ffmpeg invocation plan.
type FilterGraph struct {
	// InputArgs are the ffmpeg arguments up to and including every -i flag,
	// in order (media and audio alternating).
	InputArgs []string
	// InputPaths lists the input files in the same order as their indexes.
	InputPaths []string
	// FilterComplex is the -filter_complex expression.
	FilterComplex string
	// OutputMaps are the -map labels for the final video and audio streams.
	OutputMaps []string
}

type FilterGraphBuilder struct{}

func NewFilterGraphBuilder() *FilterGraphBuilder {
	return &FilterGraphBuilder{}
}

// MusicInput is an optional background music track mixed under the voiceover.
type MusicInput struct {
	Path        string
	DurationSec float64 // source track length, for loop computation
	Volume      float64 // linear gain, e.g. 0.15
}

func (b *FilterGraphBuilder) Build(scenes []SceneInput, assPath string, music *MusicInput) (FilterGraph, error) {
	if len(scenes) == 0 {
		return FilterGraph{}, fmt.Errorf("no scenes to render")
	}

	var (
		inputArgs  []string
		inputPaths []string
		filters    []string
		videoRefs  strings.Builder
		audioRefs  strings.Builder
	)

	for i, s := range scenes {
		if s.DurationSec <= 0 {
			return FilterGraph{}, fmt.Errorf("scene %d has non-positive duration %v", i, s.DurationSec)
		}
		mediaIdx := 2 * i
		audioIdx := 2*i + 1

		// Images enter as a single frame; zoompan's d= extends it to the
		// scene duration (looping the input would multiply frames instead).
		if !s.IsImage {
			if loops := extraLoops(s); loops > 0 {
				inputArgs = append(inputArgs, "-stream_loop", strconv.Itoa(loops))
			}
		}
		inputArgs = append(inputArgs, "-i", s.MediaPath)
		inputArgs = append(inputArgs, "-i", s.AudioPath)
		inputPaths = append(inputPaths, s.MediaPath, s.AudioPath)

		filters = append(filters, sceneFilter(mediaIdx, i, s))
		fmt.Fprintf(&videoRefs, "[v%d]", i)
		fmt.Fprintf(&audioRefs, "[%d:a]", audioIdx)
	}

	n := len(scenes)
	var totalDuration float64
	for _, s := range scenes {
		totalDuration += s.DurationSec
	}

	voiceLabel := "[aout]"
	if music != nil {
		voiceLabel = "[voice]"
	}
	filters = append(filters,
		fmt.Sprintf("%sconcat=n=%d:v=1:a=0[vcat]", videoRefs.String(), n),
		fmt.Sprintf("%sconcat=n=%d:v=0:a=1%s", audioRefs.String(), n, voiceLabel),
	)

	if music != nil {
		musicIdx := 2 * n
		if music.DurationSec > 0 && music.DurationSec < totalDuration {
			loops := int(math.Ceil(totalDuration/music.DurationSec)) - 1
			inputArgs = append(inputArgs, "-stream_loop", strconv.Itoa(loops))
		}
		inputArgs = append(inputArgs, "-i", music.Path)
		inputPaths = append(inputPaths, music.Path)

		volume := music.Volume
		if volume <= 0 {
			volume = 0.15
		}
		fadeStart := totalDuration - 2
		if fadeStart < 0 {
			fadeStart = 0
		}
		filters = append(filters,
			fmt.Sprintf("[%d:a]atrim=duration=%.3f,asetpts=PTS-STARTPTS,volume=%.3f,afade=t=out:st=%.3f:d=2[bgm]",
				musicIdx, totalDuration, volume, fadeStart),
			"[voice][bgm]amix=inputs=2:duration=first:normalize=0[aout]",
		)
	}

	videoOut := "[vcat]"
	if assPath != "" {
		filters = append(filters, fmt.Sprintf("[vcat]ass=%s[vout]", escapeFilterPath(assPath)))
		videoOut = "[vout]"
	}

	return FilterGraph{
		InputArgs:     inputArgs,
		InputPaths:    inputPaths,
		FilterComplex: strings.Join(filters, ";"),
		OutputMaps:    []string{videoOut, "[aout]"},
	}, nil
}

func sceneFilter(mediaIdx, sceneIdx int, s SceneInput) string {
	if s.IsImage {
		// Upscale first so zoompan has headroom, then ken-burns into 1080x1920.
		return fmt.Sprintf(
			"[%d:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,"+
				"zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=%d:s=%dx%d:fps=%d,"+
				"format=yuv420p,setsar=1[v%d]",
			mediaIdx, outWidth*2, outHeight*2, outWidth*2, outHeight*2,
			int(s.DurationSec*outFPS+0.5), outWidth, outHeight, outFPS,
			sceneIdx,
		)
	}
	return fmt.Sprintf(
		"[%d:v]trim=duration=%.3f,setpts=PTS-STARTPTS,"+
			"scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,"+
			"fps=%d,format=yuv420p,setsar=1[v%d]",
		mediaIdx, s.DurationSec,
		outWidth, outHeight, outWidth, outHeight,
		outFPS, sceneIdx,
	)
}

// extraLoops returns how many additional input repetitions are needed so the
// clip covers the scene duration (0 when the clip is long enough or unknown).
func extraLoops(s SceneInput) int {
	if s.MediaDurationSec <= 0 || s.MediaDurationSec >= s.DurationSec {
		return 0
	}
	return int(math.Ceil(s.DurationSec/s.MediaDurationSec)) - 1
}

// escapeFilterPath escapes characters that break ffmpeg filter arguments.
func escapeFilterPath(p string) string {
	r := strings.NewReplacer(
		`\`, `\\`,
		`:`, `\:`,
		`'`, `\'`,
		`,`, `\,`,
		`[`, `\[`,
		`]`, `\]`,
	)
	return r.Replace(p)
}
