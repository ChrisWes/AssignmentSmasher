// Shared helpers for reading uploaded files back out of R2, used by every endpoint that hands a
// file to Claude (analyze, steps, check). Keeping this in one place means those three endpoints
// can't drift on how a missing file is handled.

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
