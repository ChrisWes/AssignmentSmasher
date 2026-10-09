import { ownerEmail, unauthorized } from '../../../lib/auth.js';
import { isAdmin, forbidden } from '../../../lib/admin.js';
import { estimateCostUsd } from '../../../lib/usage.js';

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
    'SELECT id, owner_email, title, subject, start_date, end_date, status, ai_calls, ai_input_tokens, ai_output_tokens, created_at, updated_at FROM projects ' +
    'ORDER BY created_at DESC'
  ).all();

  let totalCalls = 0, totalInput = 0, totalOutput = 0;
  const projects = rows.results.map((r) => {
    const calls = r.ai_calls || 0, input = r.ai_input_tokens || 0, output = r.ai_output_tokens || 0;
    totalCalls += calls; totalInput += input; totalOutput += output;
    return Object.assign({}, r, { estimated_cost_usd: estimateCostUsd(input, output) });
  });

  return json({
    projects,
    totals: {
      calls: totalCalls, input_tokens: totalInput, output_tokens: totalOutput,
      estimated_cost_usd: estimateCostUsd(totalInput, totalOutput)
    }
  });
}
