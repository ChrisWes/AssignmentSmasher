// Shared helpers for reading and writing uploaded files (R2 + the `files` table), used by every
// endpoint that stores a file or hands one to Claude. Keeping this in one place means project
// creation and the project settings page's "add a supporting document" upload can't drift on
// validation, and analyze/steps/check can't drift on how a missing file is handled.

export const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB — generous for a text brief, tight enough to
                                                 // stay well under Claude's combined-request limit
export const MAX_SUPPORTING_FILES = 5; // a sensible cap — more than this starts costing real
                                         // tokens and getting hard for the plan to make use of
export const SUPPORTING_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

// Uploads one file to R2 and returns the D1 statement to insert its `files` row — the caller
// batches that statement alongside whatever else it's writing in the same request. file is a
// web File (from a multipart form); purpose is 'brief' | 'rubric' | 'submission' | 'supporting'.
export async function storeFile(env, projectId, file, purpose) {
  const fileId = crypto.randomUUID();
  const fallbackExt = file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] || 'bin');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || `${purpose}.${fallbackExt}`;
  const key = `projects/${projectId}/${purpose}-${fileId}-${safeName}`;
  await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return env.DB.prepare(
    'INSERT INTO files (id, project_id, purpose, r2_key, filename, content_type, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(fileId, projectId, purpose, key, file.name, file.type, file.size, Date.now());
}

// fileRow is a row from the `files` table (id, purpose, r2_key, filename, content_type, size, ...).
// Returns null if the object has gone missing from storage -- R2 and D1 can in theory drift if a
// put ever failed partway through.
export async function readFile(env, fileRow) {
  const obj = await env.FILES.get(fileRow.r2_key);
  if (!obj) return null;
  return { bytes: await obj.arrayBuffer(), contentType: fileRow.content_type };
}

// Reads every uploaded file with purpose 'supporting' for a project -- lecture notes, a photo of a
// whiteboard, earlier feedback, and so on, added alongside the brief for extra context. Silently
// skips any that have gone missing from storage, same as the brief/rubric fetch elsewhere: the
// whole plan shouldn't fail over one missing extra file when the brief itself is still fine.
export async function readSupportingFiles(env, files) {
  const rows = files.filter((f) => f.purpose === 'supporting');
  const out = [];
  for (const row of rows) {
    const file = await readFile(env, row);
    if (file) out.push(file);
  }
  return out;
}
