/* Columns:
   projects.start_date / end_date  YYYY-MM-DD
   projects.status                 draft | analyzing | outline | failed
   projects.outline_json           deliverables / criteria / ambiguities / milestones, see functions/lib/claude.js
   projects.error                  last analysis error, only set when status = failed
   projects.feedback_status        NULL | checking | ready | failed -- feedback on an uploaded draft
   projects.feedback_json          see FeedbackSchema in functions/lib/claude.js
   projects.feedback_error         last feedback-check error, only set when feedback_status = failed
   projects.ai_calls               count of Claude calls this project has made (analysis, steps, checks)
   projects.ai_input_tokens        summed input tokens across those calls -- see functions/lib/usage.js
   projects.ai_output_tokens       summed output tokens across those calls
   files.purpose                   brief | rubric | submission
*/

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  outline_json TEXT,
  error TEXT,
  feedback_status TEXT,
  feedback_json TEXT,
  feedback_error TEXT,
  ai_calls INTEGER NOT NULL DEFAULT 0,
  ai_input_tokens INTEGER NOT NULL DEFAULT 0,
  ai_output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_email, created_at);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  purpose TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_project ON files (project_id);
