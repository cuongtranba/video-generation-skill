package domain

import "time"

type Status string

const (
	StatusDraft     Status = "draft"
	StatusMaterial  Status = "material"
	StatusTuned     Status = "tuned"
	StatusConfirmed Status = "confirmed"
	StatusRendered  Status = "rendered"
	StatusPublished Status = "published"
)

func (s Status) Next() Status {
	switch s {
	case StatusDraft:
		return StatusMaterial
	case StatusMaterial:
		return StatusTuned
	case StatusTuned:
		return StatusConfirmed
	case StatusConfirmed:
		return StatusRendered
	case StatusRendered:
		return StatusPublished
	default:
		return StatusPublished
	}
}

type Voice string

const (
	VoiceBanmai  Voice = "banmai"  // northern female
	VoiceThuminh Voice = "thuminh" // northern female
	VoiceLannhi  Voice = "lannhi"  // southern female
	VoiceLinhsan Voice = "linhsan" // southern female
	VoiceLeminh  Voice = "leminh"  // northern male
	VoiceGiahuy  Voice = "giahuy"  // central male
	VoiceMyan    Voice = "myan"    // central female
)

func AllVoices() []Voice {
	return []Voice{
		VoiceBanmai, VoiceThuminh, VoiceLannhi, VoiceLinhsan,
		VoiceLeminh, VoiceGiahuy, VoiceMyan,
	}
}

func (v Voice) Valid() bool {
	for _, known := range AllVoices() {
		if v == known {
			return true
		}
	}
	return false
}

// Speed is the speech rate, -3 (slowest) to +3 (fastest).
type Speed int

func (s Speed) Valid() bool {
	return s >= -3 && s <= 3
}

type MaterialType string

const (
	MaterialVideo MaterialType = "video"
	MaterialImage MaterialType = "image"
	MaterialLocal MaterialType = "local"
)

type CaptionStyle struct {
	FontName string `json:"font_name"`
	FontSize int    `json:"font_size"`
	Primary  string `json:"primary"`
	Outline  string `json:"outline"`
	Bold     bool   `json:"bold"`
}

type StyleSettings struct {
	Voice        Voice        `json:"voice"`
	Speed        Speed        `json:"speed"`
	DurationSec  int          `json:"duration_sec"`
	Tone         string       `json:"tone"`
	CaptionStyle CaptionStyle `json:"caption_style"`
	MusicPath    string       `json:"music_path,omitempty"`
	MusicTrack   string       `json:"music_track,omitempty"` // attribution: artist — title (source id)
	MusicVolume  float64      `json:"music_volume,omitempty"`
}

type MaterialRef struct {
	Type        MaterialType `json:"type"`
	SourceID    string       `json:"source_id"`
	LocalPath   string       `json:"local_path"`
	DurationSec float64      `json:"duration_sec"`
}

type Scene struct {
	Index       int         `json:"index"`
	Narration   string      `json:"narration"`
	VisualNote  string      `json:"visual_note"`
	Material    MaterialRef `json:"material"`
	AudioPath   string      `json:"audio_path"`
	DurationSec float64     `json:"duration_sec"`
}

type CostUnit string

const (
	UnitTokens   CostUnit = "tokens"
	UnitChars    CostUnit = "chars"
	UnitAPICalls CostUnit = "api_calls"
)

type CostLineItem struct {
	Label    string   `json:"label"`
	Unit     CostUnit `json:"unit"`
	Quantity int64    `json:"quantity"`
	USDCost  float64  `json:"usd_cost"`
}

type CostLedger struct {
	Projected []CostLineItem `json:"projected"`
	Actual    []CostLineItem `json:"actual"`
	CapUSD    float64        `json:"cap_usd"`
}

func (l CostLedger) ProjectedTotal() float64 {
	return sumItems(l.Projected)
}

func (l CostLedger) ActualTotal() float64 {
	return sumItems(l.Actual)
}

func sumItems(items []CostLineItem) float64 {
	var total float64
	for _, it := range items {
		total += it.USDCost
	}
	return total
}

type Project struct {
	ID          string        `json:"id"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
	Status      Status        `json:"status"`
	Idea        string        `json:"idea"`
	ResourceDir string        `json:"resource_dir,omitempty"`
	Scenes      []Scene       `json:"scenes"`
	Style       StyleSettings `json:"style"`
	OutputPath  string        `json:"output_path,omitempty"`
	ProjectDir  string        `json:"project_dir"`
	CostLedger  CostLedger    `json:"cost_ledger"`
}
