import { ownerEmail, unauthorized } from '../lib/auth.js';
import { isAdmin } from '../lib/admin.js';

export async function onRequestGet({ request, env }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  return new Response(JSON.stringify({ email: owner, isAdmin: isAdmin(owner, env) }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
