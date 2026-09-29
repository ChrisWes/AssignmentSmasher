import { ownerEmail, unauthorized } from '../../../lib/auth.js';
import { isAdmin, forbidden } from '../../../lib/admin.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequestGet({ request, env }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!isAdmin(owner, env)) return forbidden();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);

  const rows = await env.DB.prepare(
    'SELECT id, owner_email, title, subject, start_date, end_date, status, created_at, updated_at FROM projects ' +
    'ORDER BY created_at DESC'
  ).all();

  return json({ projects: rows.results });
}
