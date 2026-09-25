import { jwtVerify, createRemoteJWKSet } from 'jose';

// Cloudflare Access sits in front of the whole site in production. It authenticates the person
// and attaches a signed JWT (Cf-Access-Jwt-Assertion) to every request it lets through — that JWT
// is what's actually trustworthy. Access ALSO sometimes sets a plain Cf-Access-Authenticated-User-
// Email header as a convenience, but on a Cloudflare Pages project that header is not reliably
// present (confirmed by testing: the JWT was there, the header wasn't), so it can't be the thing
// this depends on. It's also not safe to trust on its own even when present — every Pages project
// keeps an unprotected *.pages.dev fallback address alongside any custom domain, so anyone who
// found that address could set that header themselves in a raw request and impersonate any email.
// Verifying the JWT's signature against Access's own public keys is what actually proves a request
// came from someone Access authenticated, rather than someone who just typed a header.
//
// Needs env.ACCESS_AUD — the Application Audience (AUD) Tag from this Access application's
// Overview page in the Cloudflare dashboard. Without it, the JWT signature still gets checked, but
// not which Access application it was issued for — see SETUP.md.
//
// For local testing, where there is no Access in front of wrangler, DEV_MODE stands in for it.
// DEV_MODE must never be set on the real Cloudflare project.

const TEAM_DOMAIN = 'bold-scene-f4af.cloudflareaccess.com';

let jwks = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL('https://' + TEAM_DOMAIN + '/cdn-cgi/access/certs'));
  return jwks;
}

export async function ownerEmail(request, env) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (jwt) {
    try {
      const { payload } = await jwtVerify(jwt, getJwks(), env.ACCESS_AUD ? { audience: env.ACCESS_AUD } : {});
      if (payload && typeof payload.email === 'string' && payload.email) {
        return payload.email.toLowerCase().trim();
      }
    } catch (e) {
      // Invalid, expired, or forged token — treat as unauthenticated rather than throwing.
    }
  }

  if (env.DEV_MODE === '1') return 'dev@local.test';
  return null;
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
