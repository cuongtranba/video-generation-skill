package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

const manifestFileName = "manifest.json"

var ErrProjectNotFound = errors.New("project not found")

type ManifestStore struct {
	baseDir string
}

func NewManifestStore(baseDir string) *ManifestStore {
	return &ManifestStore{baseDir: baseDir}
}

func (s *ManifestStore) ProjectDir(projectID string) string {
	return filepath.Join(s.baseDir, projectID)
}

func (s *ManifestStore) Save(p *Project) error {
	dir := s.ProjectDir(p.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create project dir %s: %w", dir, err)
	}

	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal manifest for project %s: %w", p.ID, err)
	}

	path := filepath.Join(dir, manifestFileName)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write manifest tmp for project %s: %w", p.ID, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("commit manifest for project %s: %w", p.ID, err)
	}
	return nil
}

func (s *ManifestStore) Load(projectID string) (*Project, error) {
	path := filepath.Join(s.ProjectDir(projectID), manifestFileName)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("load project %s: %w", projectID, ErrProjectNotFound)
		}
		return nil, fmt.Errorf("read manifest for project %s: %w", projectID, err)
	}

	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("unmarshal manifest for project %s: %w", projectID, err)
	}
	return &p, nil
}

func (s *ManifestStore) List() ([]Project, error) {
	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read projects dir %s: %w", s.baseDir, err)
	}

	var projects []Project
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p, err := s.Load(e.Name())
		if err != nil {
			if errors.Is(err, ErrProjectNotFound) {
				continue
			}
			return nil, fmt.Errorf("list project %s: %w", e.Name(), err)
		}
		projects = append(projects, *p)
	}
	return projects, nil
}
