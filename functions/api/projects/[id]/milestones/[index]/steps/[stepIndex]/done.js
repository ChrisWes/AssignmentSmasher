import { ownerEmail, unauthorized } from '../../../../../../../lib/auth.js';
import { computeSchedule } from '../../../../../../../lib/dates.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Marks one step within one milestone done or not done. No Claude call, just a flag flip, same as
// the milestone-level done.js this sits alongside.
export async function onRequestPost({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);

  const idx = Number(params.index);
  const stepIdx = Number(params.stepIndex);
  if (!Number.isInteger(idx) || idx < 0) return json({ error: 'Bad milestone index' }, 400);
  if (!Number.isInteger(stepIdx) || stepIdx < 0) return json({ error: 'Bad step index' }, 400);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  if (typeof body.done !== 'boolean') return json({ error: '"done" must be true or false' }, 400);

  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_email = ?').bind(params.id, owner).first();
  if (!row) return json({ error: 'Not found' }, 404);
  if (!row.outline_json) return json({ error: 'There is no plan yet for this project.' }, 400);

  const outline = JSON.parse(row.outline_json);
  const milestone = outline.milestones && outline.milestones[idx];
  if (!milestone || !Array.isArray(milestone.steps)) return json({ error: 'No steps generated for that milestone yet.' }, 404);
  if (!milestone.steps[stepIdx]) return json({ error: 'No step at that position.' }, 404);

  // Normalises any step still stored as a bare string (generated before step-ticking existed) into
  // { text, done } the first time any step in this milestone is touched.
  milestone.steps = milestone.steps.map((s) => (typeof s === 'string' ? { text: s, done: false } : s));
  milestone.steps[stepIdx] = Object.assign({}, milestone.steps[stepIdx], { done: body.done });
  outline.milestones[idx] = milestone;

  const now = Date.now();
  await env.DB.prepare('UPDATE projects SET outline_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(outline), now, row.id).run();

  const schedule = computeSchedule(row.start_date, row.end_date, outline.milestones);
  return json({ milestones: schedule.milestones });
}
