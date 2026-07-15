package prereq

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

type Requirement struct {
	Name        string
	EnvOverride string
	DefaultBin  string
	MinMajor    int // 0 = presence check only
	VersionFlag string
	VersionRe   string
}

type Checker struct {
	requirements []Requirement
	resolved     map[string]string
}

func NewChecker() *Checker {
	return &Checker{
		requirements: []Requirement{
			{
				Name:        "ffmpeg",
				EnvOverride: "FFMPEG_BIN",
				DefaultBin:  "ffmpeg",
				MinMajor:    5,
				VersionFlag: "-version",
				VersionRe:   `ffmpeg version (\d+)`,
			},
			{
				Name:        "ffprobe",
				EnvOverride: "FFPROBE_BIN",
				DefaultBin:  "ffprobe",
				MinMajor:    5,
				VersionFlag: "-version",
				VersionRe:   `ffprobe version (\d+)`,
			},
			{
				Name:        "whisper",
				EnvOverride: "WHISPER_BIN",
				DefaultBin:  "whisper",
			},
		},
		resolved: map[string]string{},
	}
}

// Check validates every requirement and returns a joined error listing all
// missing or outdated binaries.
func (c *Checker) Check() error {
	var errs []error
	for _, req := range c.requirements {
		path, err := c.checkOne(req)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		c.resolved[req.Name] = path
	}
	return errors.Join(errs...)
}

func (c *Checker) Resolve(name string) (string, error) {
	if path, ok := c.resolved[name]; ok {
		return path, nil
	}
	for _, req := range c.requirements {
		if req.Name != name {
			continue
		}
		path, err := c.checkOne(req)
		if err != nil {
			return "", err
		}
		c.resolved[name] = path
		return path, nil
	}
	return "", fmt.Errorf("unknown prerequisite %q", name)
}

func (c *Checker) checkOne(req Requirement) (string, error) {
	bin := req.DefaultBin
	if override := os.Getenv(req.EnvOverride); override != "" {
		bin = override
	}

	path, err := exec.LookPath(bin)
	if err != nil {
		return "", fmt.Errorf("%s not found (checked %q, override via %s): %w", req.Name, bin, req.EnvOverride, err)
	}

	if req.MinMajor > 0 {
		if err := checkVersion(path, req); err != nil {
			return "", err
		}
	}
	return path, nil
}

func checkVersion(path string, req Requirement) error {
	out, err := exec.Command(path, req.VersionFlag).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s version check (%s %s): %w", req.Name, path, req.VersionFlag, err)
	}

	re, err := regexp.Compile(req.VersionRe)
	if err != nil {
		return fmt.Errorf("%s version regex: %w", req.Name, err)
	}

	m := re.FindStringSubmatch(string(out))
	if len(m) < 2 {
		return fmt.Errorf("%s version not parseable from output %q", req.Name, firstLine(string(out)))
	}

	major, err := strconv.Atoi(m[1])
	if err != nil {
		return fmt.Errorf("%s version %q: %w", req.Name, m[1], err)
	}
	if major < req.MinMajor {
		return fmt.Errorf("%s version %d too old, need >= %d", req.Name, major, req.MinMajor)
	}
	return nil
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(s, "\n")
	return line
}
