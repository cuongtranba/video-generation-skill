-- Read-model tables folded from VIDGEN_EVENTS by api/src/projections.ts.
-- Postgres is disposable: TRUNCATE + replay from stream seq 0 fully
-- rebuilds these tables (see projections.rebuildProjections). Every
-- statement is idempotent so this file can be re-run safely.

CREATE TABLE IF NOT EXISTS projects (
  project_id   TEXT PRIMARY KEY,
  idea         TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  scene_count  INTEGER NOT NULL,
  tone         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  spent_usd    NUMERIC(10,4) NOT NULL DEFAULT 0,
  approved     BOOLEAN NOT NULL DEFAULT FALSE,
  output_path  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenes (
  project_id      TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  narration       TEXT NOT NULL,
  visual          TEXT NOT NULL,
  material_source TEXT,
  material_path   TEXT,
  mp3_path        TEXT,
  tts_usd         NUMERIC(10,4),
  ass_path        TEXT,
  PRIMARY KEY (project_id, idx)
);

CREATE TABLE IF NOT EXISTS assets (
  id         SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  scene_idx  INTEGER,
  kind       TEXT NOT NULL CHECK (kind IN ('material', 'voice', 'caption', 'render')),
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- scene_idx is NULL for project-level assets (render output). Postgres
-- treats NULLs as distinct in a plain UNIQUE constraint, which would break
-- idempotent re-application of RenderCompleted during replay — so dedupe
-- on COALESCE(scene_idx, -1) instead of the raw column.
CREATE UNIQUE INDEX IF NOT EXISTS assets_dedup_idx
  ON assets (project_id, kind, COALESCE(scene_idx, -1));

CREATE TABLE IF NOT EXISTS cost_ledger (
  id         SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  scene_idx  INTEGER,
  amount_usd NUMERIC(10,4) NOT NULL,
  at         TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_ledger_dedup_idx
  ON cost_ledger (project_id, event_type, COALESCE(scene_idx, -1));
