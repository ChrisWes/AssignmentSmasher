// Temporary diagnostic endpoint — not linked from the app, not sensitive (no project data), just
// echoes back what this request looked like to the Function. Delete once Access is confirmed
// working correctly; it isn't meant to stay in the app long-term.

export async function onRequestGet({ request, env }) {
  const headerNames = [
    'cf-access-authenticated-user-email',
    'cf-access-jwt-assertion',
    'cf-ray',
    'cf-connecting-ip',
    'cookie'
  ];
  const headers = {};
  for (const name of headerNames) {
    const v = request.headers.get(name);
    headers[name] = v
      ? (name === 'cookie' || name === 'cf-access-jwt-assertion' ? `present (${v.length} chars)` : v)
      : null;
  }

  const allHeaderNames = [];
  for (const [k] of request.headers.entries()) allHeaderNames.push(k);

  return new Response(JSON.stringify({
    headers,
    allHeaderNames,
    devModeVar: env.DEV_MODE || null
  }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
