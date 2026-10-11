import { ownerEmail, unauthorized } from '../../../lib/auth.js';
import { analyzeBrief } from '../../../lib/claude.js';
import { computeSchedule } from '../../../lib/dates.js';
import { recordUsageStatement } from '../../../lib/usage.js';
import { readSupportingFiles } from '../../../lib/files.js';

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

  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_email = ?').bind(params.id, owner).first();
  if (!row) return json({ error: 'Not found' }, 404);
  if (row.status === 'analyzing') return json({ error: 'Already analysing this brief.' }, 409);

  const files = (await env.DB.prepare('SELECT * FROM files WHERE project_id = ?').bind(row.id).all()).results;
  const briefFile = files.find((f) => f.purpose === 'brief');
  const rubricFile = files.find((f) => f.purpose === 'rubric');
  if (!briefFile) return json({ error: 'No brief was uploaded for this project.' }, 400);

  await env.DB.prepare('UPDATE projects SET status = ?, error = NULL, updated_at = ? WHERE id = ?')
    .bind('analyzing', Date.now(), row.id).run();

  try {
    const briefObj = await env.FILES.get(briefFile.r2_key);
    if (!briefObj) throw new Error('The brief file has gone missing from storage. Try creating the project again.');
    const brief = { bytes: await briefObj.arrayBuffer(), contentType: briefFile.content_type };

    let rubric = null;
    if (rubricFile) {
      const rubricObj = await env.FILES.get(rubricFile.r2_key);
      if (rubricObj) rubric = { bytes: await rubricObj.arrayBuffer(), contentType: rubricFile.content_type };
    }

    const supporting = await readSupportingFiles(env, files);

    const { outline, usage } = await analyzeBrief(env.ANTHROPIC_API_KEY, {
      subject: row.subject, startDate: row.start_date, endDate: row.end_date, brief, rubric,
      additionalContext: row.additional_context, supporting
    });

    // A fresh read replaces the whole plan, including every milestone — otherwise a milestone
    // ticked done, or one with a generated step checklist, would silently vanish the moment the
    // student re-reads the brief after adding context. Where the new plan has a milestone with the
    // exact same title as before (the common case — re-reading after adding context rarely changes
    // the milestone structure itself), carry its done flag and steps across. A milestone whose title
    // changed, or that's new, starts fresh, same as before.
    const priorOutline = row.outline_json ? JSON.parse(row.outline_json) : null;
    const priorByTitle = new Map();
    (priorOutline && Array.isArray(priorOutline.milestones) ? priorOutline.milestones : []).forEach((m) => {
      if (m && typeof m.title === 'string') priorByTitle.set(m.title.trim().toLowerCase(), m);
    });
    outline.milestones = outline.milestones.map((m) => {
      const prior = priorByTitle.get(m.title.trim().toLowerCase());
      if (!prior) return m;
      const carried = Object.assign({}, m);
      if (typeof prior.done === 'boolean') carried.done = prior.done;
      if (Array.isArray(prior.steps)) carried.steps = prior.steps;
      return carried;
    });

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('UPDATE projects SET status = ?, outline_json = ?, error = NULL, updated_at = ? WHERE id = ?')
        .bind('outline', JSON.stringify(outline), now, row.id),
      recordUsageStatement(env, row.id, usage)
    ]);

    const schedule = computeSchedule(row.start_date, row.end_date, outline.milestones);
    return json({
      id: row.id, status: 'outline',
      outline: {
        deliverables: outline.deliverables,
        assessment_criteria: outline.assessment_criteria,
        ambiguities: outline.ambiguities,
        milestones: schedule.milestones,
        schedule: {
          total_days: schedule.total_days, needed_days: schedule.needed_days,
          usable_days: schedule.usable_days, buffer_days: schedule.buffer_days,
          overcommitted: schedule.overcommitted
        }
      }
    });
  } catch (err) {
    const message = (err && err.message) ? err.message : 'Something went wrong reading the brief.';
    await env.DB.prepare('UPDATE projects SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .bind('failed', message, Date.now(), row.id).run();
    return json({ error: message }, 502);
  }
}
