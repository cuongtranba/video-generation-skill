// Package videogen defines the seam for AI clip-generation providers
// (e.g. Runway, Kling). No provider is implemented yet; the interface exists
// so config selection and future wiring have a stable contract.
package videogen

import "context"

type ClipRequest struct {
	Prompt      string
	DurationSec float64
	Width       int
	Height      int
}

type ClipResult struct {
	ClipPath    string
	DurationSec float64
}

// ClipGenerator produces a video clip from a text prompt.
type ClipGenerator interface {
	Generate(ctx context.Context, req ClipRequest, destPath string) (ClipResult, error)
}
