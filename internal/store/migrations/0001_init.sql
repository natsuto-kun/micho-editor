CREATE TABLE scenarios (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  system      TEXT,
  players     TEXT,
  play_time   TEXT,
  meta        TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE sections (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES sections(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  sort_key    TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_sections_scenario ON sections(scenario_id, sort_key);
CREATE INDEX idx_sections_parent   ON sections(parent_id, sort_key);

CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER NOT NULL,
  rel_path    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,
  section_id  TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,
  body_gz     BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_snapshots_section ON snapshots(section_id, created_at DESC);

CREATE TABLE links (
  from_id     TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  PRIMARY KEY (from_id, to_id)
);
