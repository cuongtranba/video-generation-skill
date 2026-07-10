-- Style settings projection from StyleSet events (last-write-wins per project).
-- uploaded_assets tracks files uploaded via POST /projects/:id/assets.
-- Both statements are idempotent: safe to re-run.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS style JSONB;

CREATE TABLE IF NOT EXISTS uploaded_assets (
  id          SERIAL PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  path        TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, filename)
);
