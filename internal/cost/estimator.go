package cost

import (
	"github.com/cuongtranba/video-generation-skill/internal/domain"
)

// FPTAIPerChar is the approximate FPT.AI TTS price per character in USD.
// Verify against the FPT console rate card before production use.
const FPTAIPerChar = 0.000010

type Estimator struct{}

func NewEstimator() *Estimator {
	return &Estimator{}
}

func (e *Estimator) EstimateTTS(chars int64) domain.CostLineItem {
	return domain.CostLineItem{
		Label:    "FPT.AI TTS",
		Unit:     domain.UnitChars,
		Quantity: chars,
		USDCost:  float64(chars) * FPTAIPerChar,
	}
}

// EstimateProject projects the full generation cost for the given scenes.
// Script generation runs on the claude CLI subscription and stock material
// APIs are free tier, so TTS is the only projected paid line item.
func (e *Estimator) EstimateProject(scenes []domain.Scene) []domain.CostLineItem {
	var chars int64
	for _, s := range scenes {
		chars += int64(len([]rune(s.Narration)))
	}
	return []domain.CostLineItem{e.EstimateTTS(chars)}
}
