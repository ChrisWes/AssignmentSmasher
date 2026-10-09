import { ownerEmail, unauthorized } from '../../../../../lib/auth.js';
import { computeSchedule } from '../../../../../lib/dates.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Marks one milestone done or not done. No Claude call — this just flips a flag, so it's instant,
// unlike generating steps or checking a draft.
export async function onRequestPost({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);

  const idx = Number(params.index);
  if (!Number.isInteger(idx) || idx < 0) return json({ error: 'Bad milestone index' }, 400);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  if (typeof body.done !== 'boolean') return json({ error: '"done" must be true or false' }, 400);

  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_email = ?').bind(params.id, owner).first();
  if (!row) return json({ error: 'Not found' }, 404);
  if (!row.outline_json) return json({ error: 'There is no plan yet for this project.' }, 400);

  const outline = JSON.parse(row.outline_json);
  const milestone = outline.milestones && outline.milestones[idx];
  if (!milestone) return json({ error: 'No milestone at that position.' }, 404);

  outline.milestones[idx] = Object.assign({}, milestone, { done: body.done });
  const now = Date.now();
  await env.DB.prepare('UPDATE projects SET outline_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(outline), now, row.id).run();

  const schedule = computeSchedule(row.start_date, row.end_date, outline.milestones);
  return json({ milestones: schedule.milestones });
}
