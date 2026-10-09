import { ownerEmail, unauthorized } from '../../../../../lib/auth.js';
import { generateMilestoneSteps } from '../../../../../lib/claude.js';
import { computeSchedule } from '../../../../../lib/dates.js';
import { recordUsageStatement } from '../../../../../lib/usage.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export async function onRequestPost({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);
  if (!env.FILES) return json({ error: 'File storage not bound' }, 500);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude API key not configured' }, 500);

  const idx = Number(params.index);
  if (!Number.isInteger(idx) || idx < 0) return json({ error: 'Bad milestone index' }, 400);

  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_email = ?').bind(params.id, owner).first();
  if (!row) return json({ error: 'Not found' }, 404);
  if (!row.outline_json) return json({ error: 'There is no plan yet for this project.' }, 400);

  const outline = JSON.parse(row.outline_json);
  const milestone = outline.milestones && outline.milestones[idx];
  if (!milestone) return json({ error: 'No milestone at that position.' }, 404);

  const files = (await env.DB.prepare('SELECT * FROM files WHERE project_id = ?').bind(row.id).all()).results;
  const briefFile = files.find((f) => f.purpose === 'brief');
  if (!briefFile) return json({ error: 'The original brief is missing for this project.' }, 400);

  try {
    const briefObj = await env.FILES.get(briefFile.r2_key);
    if (!briefObj) throw new Error('The brief file has gone missing from storage.');
    const brief = { bytes: await briefObj.arrayBuffer(), contentType: briefFile.content_type };

    const rubricFile = files.find((f) => f.purpose === 'rubric');
    let rubric = null;
    if (rubricFile) {
      const rubricObj = await env.FILES.get(rubricFile.r2_key);
      if (rubricObj) rubric = { bytes: await rubricObj.arrayBuffer(), contentType: rubricFile.content_type };
    }

    const { steps, usage } = await generateMilestoneSteps(env.ANTHROPIC_API_KEY, {
      subject: row.subject,
      deliverables: outline.deliverables,
      assessmentCriteria: outline.assessment_criteria,
      milestone: { title: milestone.title, goal: milestone.goal },
      brief, rubric
    });

    // Each step is tickable on its own (see milestones/[index]/steps/[stepIndex]/done.js) — stored
    // as an object, not a bare string, so there's somewhere to put that state. A regenerate here
    // always starts the new list fresh (done: false), same as a fresh generate.
    outline.milestones[idx] = Object.assign({}, milestone, { steps: steps.map((text) => ({ text, done: false })) });
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('UPDATE projects SET outline_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(outline), now, row.id),
      recordUsageStatement(env, row.id, usage)
    ]);

    const schedule = computeSchedule(row.start_date, row.end_date, outline.milestones);
    return json({ milestones: schedule.milestones });
  } catch (err) {
    const message = (err && err.message) ? err.message : 'Something went wrong generating steps.';
    return json({ error: message }, 502);
  }
}
