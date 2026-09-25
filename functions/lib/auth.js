// Cloudflare Access sits in front of the whole site in production and adds this header to every
// request it lets through, after verifying the person's identity itself. We trust the header only
// because Access's own network rule is what stops anyone reaching these functions without it — see
// SETUP.md. For local testing, where there is no Access in front of wrangler, DEV_MODE stands in for
// it. DEV_MODE must never be set on the real Cloudflare project.

export function ownerEmail(request, env) {
  const header = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (header) return header.toLowerCase().trim();
  if (env.DEV_MODE === '1') return 'dev@local.test';
  return null;
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
