// Admin is anyone whose verified email is on env.ADMIN_EMAILS — a comma-separated list set as a
// Cloudflare Pages environment variable, not something stored in the database or hardcoded here.
// See SETUP.md.

export function isAdmin(email, env) {
  if (!email || !env.ADMIN_EMAILS) return false;
  var list = String(env.ADMIN_EMAILS).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  return list.indexOf(String(email).toLowerCase()) !== -1;
}

export function forbidden() {
  return new Response(JSON.stringify({ error: 'Admins only.' }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
