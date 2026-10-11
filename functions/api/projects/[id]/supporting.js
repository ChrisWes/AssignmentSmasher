import { ownerEmail, unauthorized } from '../../../lib/auth.js';
import { storeFile, MAX_FILE_BYTES, MAX_SUPPORTING_FILES, SUPPORTING_TYPES } from '../../../lib/files.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function badRequest(message) {
  return json({ error: message }, 400);
}

// Adds one or more supporting documents to a project that already exists — the project settings
// page's "add a supporting document" upload. Project creation (functions/api/projects/index.js)
// handles the first batch of these; this covers adding more later, which is the common case: a
// document surfaces, or answers a question, only after the first read of the brief.
export async function onRequestPost({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);
  if (!env.FILES) return json({ error: 'File storage not bound' }, 500);

  const row = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND owner_email = ?').bind(params.id, owner).first();
  if (!row) return json({ error: 'Not found' }, 404);

  let form;
  try { form = await request.formData(); } catch (e) { return badRequest('Could not read the upload. Try again.'); }

  const newFiles = form.getAll('supporting').filter((f) => f instanceof File && f.size > 0);
  if (!newFiles.length) return badRequest('Choose at least one file.');
  for (const f of newFiles) {
    if (!SUPPORTING_TYPES.has(f.type)) return badRequest('"' + f.name + '" is not a PDF or a supported image type (JPG, PNG, GIF or WEBP).');
    if (f.size > MAX_FILE_BYTES) return badRequest('"' + f.name + '" is larger than 8MB — try a smaller file.');
  }

  // The cap is on the project's total, not this one upload — a student adding one file at a time
  // could otherwise sail past it a file at a time.
  const existing = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND purpose = ?'
  ).bind(row.id, 'supporting').first();
  const remaining = MAX_SUPPORTING_FILES - existing.n;
  if (newFiles.length > remaining) {
    return badRequest(remaining <= 0
      ? 'This project already has the most supporting files allowed (' + MAX_SUPPORTING_FILES + ').'
      : 'Only ' + remaining + ' more supporting file' + (remaining === 1 ? '' : 's') + ' can be added to this project (' + MAX_SUPPORTING_FILES + ' at most).');
  }

  const stmts = [];
  for (const f of newFiles) {
    stmts.push(await storeFile(env, row.id, f, 'supporting'));
  }
  await env.DB.batch(stmts);

  const files = (await env.DB.prepare('SELECT id, purpose, filename FROM files WHERE project_id = ?').bind(row.id).all()).results;
  return json({ files: files.map((f) => ({ id: f.id, purpose: f.purpose, filename: f.filename })) }, 201);
}
