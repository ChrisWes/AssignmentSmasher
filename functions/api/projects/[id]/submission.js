import { ownerEmail, unauthorized } from '../../../lib/auth.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024; // mirrors the brief/rubric cap in functions/api/projects/index.js

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Uploads (or replaces) the student's draft/final document for this project. Re-uploading clears
// any previous feedback, since that feedback was about a different document.
export async function onRequestPost({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);
  if (!env.FILES) return json({ error: 'File storage not bound' }, 500);

  const row = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND owner_email = ?').bind(params.id, owner).first();
  if (!row) return json({ error: 'Not found' }, 404);

  let form;
  try { form = await request.formData(); } catch (e) { return json({ error: 'Could not read the upload. Try again.' }, 400); }

  const file = form.get('submission');
  if (!(file instanceof File) || file.size === 0) return json({ error: 'Choose your draft or final document as a PDF.' }, 400);
  if (file.type !== 'application/pdf') return json({ error: 'The document must be a PDF.' }, 400);
  if (file.size > MAX_FILE_BYTES) return json({ error: 'That file is larger than 8MB — try a smaller file.' }, 400);

  const prior = (await env.DB.prepare('SELECT id, r2_key FROM files WHERE project_id = ? AND purpose = ?').bind(row.id, 'submission').all()).results;
  if (prior.length && env.FILES) {
    try { await env.FILES.delete(prior.map((f) => f.r2_key)); }
    catch (e) { /* best-effort — the database rows still get cleaned up below either way */ }
  }

  const fileId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'submission.pdf';
  const key = `projects/${row.id}/submission-${fileId}-${safeName}`;
  await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const now = Date.now();
  const stmts = prior.map((f) => env.DB.prepare('DELETE FROM files WHERE id = ?').bind(f.id));
  stmts.push(env.DB.prepare(
    'INSERT INTO files (id, project_id, purpose, r2_key, filename, content_type, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(fileId, row.id, 'submission', key, file.name, file.type, file.size, now));
  stmts.push(env.DB.prepare(
    'UPDATE projects SET feedback_status = NULL, feedback_json = NULL, feedback_error = NULL, updated_at = ? WHERE id = ?'
  ).bind(now, row.id));
  await env.DB.batch(stmts);

  return json({ ok: true, filename: file.name });
}
