import { ownerEmail, unauthorized } from '../../../lib/auth.js';
import { computeSchedule } from '../../../lib/dates.js';

const MAX_TITLE = 200;
const MAX_SUBJECT = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function badRequest(message) {
  return json({ error: message }, 400);
}

async function loadProject(env, owner, id) {
  return env.DB.prepare(
    'SELECT * FROM projects WHERE id = ? AND owner_email = ?'
  ).bind(id, owner).first();
}

function present(row, files) {
  const out = {
    id: row.id, title: row.title, subject: row.subject,
    start_date: row.start_date, end_date: row.end_date,
    status: row.status, error: row.error || null,
    created_at: row.created_at, updated_at: row.updated_at,
    files: files.map((f) => ({ id: f.id, purpose: f.purpose, filename: f.filename })),
    outline: null
  };
  if (row.outline_json) {
    const outline = JSON.parse(row.outline_json);
    const schedule = computeSchedule(row.start_date, row.end_date, outline.milestones);
    out.outline = {
      deliverables: outline.deliverables,
      assessment_criteria: outline.assessment_criteria,
      ambiguities: outline.ambiguities,
      milestones: schedule.milestones,
      schedule: {
        total_days: schedule.total_days,
        needed_days: schedule.needed_days,
        usable_days: schedule.usable_days,
        buffer_days: schedule.buffer_days,
        overcommitted: schedule.overcommitted
      }
    };
  }
  return out;
}

export async function onRequestGet({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);

  const row = await loadProject(env, owner, params.id);
  if (!row) return json({ error: 'Not found' }, 404);
  const files = await env.DB.prepare('SELECT id, purpose, filename FROM files WHERE project_id = ?').bind(row.id).all();

  return json(present(row, files.results));
}

export async function onRequestPatch({ request, env, params }) {
  const owner = await ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);

  const row = await loadProject(env, owner, params.id);
  if (!row) return json({ error: 'Not found' }, 404);
  if (row.status === 'analyzing') return badRequest('Still reading the brief — try again in a moment.');

  let body;
  try { body = await request.json(); } catch (e) { return badRequest('Bad JSON.'); }
  if (!body || typeof body !== 'object') return badRequest('Bad body.');

  const title = 'title' in body ? String(body.title || '').trim() : row.title;
  const subject = 'subject' in body ? String(body.subject || '').trim() : row.subject;
  const startDate = 'start_date' in body ? String(body.start_date || '').trim() : row.start_date;
  const endDate = 'end_date' in body ? String(body.end_date || '').trim() : row.end_date;

  if (!title) return badRequest('Give the project a title.');
  if (title.length > MAX_TITLE) return badRequest('That title is too long.');
  if (subject.length > MAX_SUBJECT) return badRequest('That subject is too long.');
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return badRequest('Start and end dates must be real dates.');
  if (endDate <= startDate) return badRequest('The deadline needs to be after the start date.');

  let outlineJson = row.outline_json;
  if ('outline' in body) {
    if (!row.outline_json) return badRequest('There is no plan yet to edit.');
    const existing = JSON.parse(row.outline_json);
    const edit = body.outline || {};
    const milestones = Array.isArray(edit.milestones) ? edit.milestones : existing.milestones;

    for (const m of milestones) {
      if (!m || typeof m.title !== 'string' || !m.title.trim()) return badRequest('Every milestone needs a title.');
      if (typeof m.goal !== 'string') return badRequest('Every milestone needs a goal.');
      const days = Number(m.duration_days);
      if (!Number.isInteger(days) || days < 1 || days > 120) return badRequest('Milestone durations must be between 1 and 120 days.');
    }

    outlineJson = JSON.stringify({
      deliverables: existing.deliverables,
      assessment_criteria: existing.assessment_criteria,
      ambiguities: existing.ambiguities,
      milestones: milestones.map((m) => ({ title: m.title.trim(), goal: m.goal.trim(), duration_days: Number(m.duration_days) }))
    });
  }

  const now = Date.now();
  await env.DB.prepare(
    'UPDATE projects SET title = ?, subject = ?, start_date = ?, end_date = ?, outline_json = ?, updated_at = ? WHERE id = ? AND owner_email = ?'
  ).bind(title, subject, startDate, endDate, outlineJson, now, row.id, owner).run();

  const updated = await loadProject(env, owner, row.id);
  const files = await env.DB.prepare('SELECT id, purpose, filename FROM files WHERE project_id = ?').bind(row.id).all();
  return json(present(updated, files.results));
}
