import { ownerEmail, unauthorized } from '../lib/auth.js';

export async function onRequestGet({ request, env }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  return new Response(JSON.stringify({ email: owner }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
