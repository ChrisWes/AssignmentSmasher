CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,          -- YYYY-MM-DD
  end_date TEXT NOT NULL,            -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | analyzing | outline | failed
  outline_json TEXT,                 -- deliverables / criteria / ambiguities / milestones, see functions/lib/claude.js
  error TEXT,                        -- last analysis error, if status = failed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_email, created_at);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  purpose TEXT NOT NULL,             -- brief | rubric
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_project ON files (project_id);
