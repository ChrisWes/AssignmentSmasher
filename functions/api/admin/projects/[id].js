import { ownerEmail, unauthorized } from '../../../lib/auth.js';
import { isAdmin, forbidden } from '../../../lib/admin.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequestDelete({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!isAdmin(owner, env)) return forbidden();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);

  const row = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(params.id).first();
  if (!row) return json({ error: 'Not found' }, 404);

  const files = (await env.DB.prepare('SELECT r2_key FROM files WHERE project_id = ?').bind(params.id).all()).results;
  if (files.length && env.FILES) {
    try { await env.FILES.delete(files.map(function (f) { return f.r2_key; })); }
    catch (e) { /* best-effort — the database rows still get cleaned up below either way */ }
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM files WHERE project_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(params.id)
  ]);

  return json({ ok: true });
}
