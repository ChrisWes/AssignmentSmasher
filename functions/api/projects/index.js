import { ownerEmail, unauthorized } from '../../lib/auth.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB — generous for a text brief, tight enough to stay
                                          // well under Claude's combined-request document limit
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

export async function onRequestGet({ request, env }) {
  const owner = ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);

  const rows = await env.DB.prepare(
    'SELECT id, title, subject, start_date, end_date, status, created_at, updated_at FROM projects ' +
    'WHERE owner_email = ? ORDER BY created_at DESC'
  ).bind(owner).all();

  return json({ projects: rows.results });
}

export async function onRequestPost({ request, env }) {
  const owner = ownerEmail(request, env);
  if (!owner) return unauthorized();
  if (!env.DB) return json({ error: 'Database not bound' }, 500);
  if (!env.FILES) return json({ error: 'File storage not bound' }, 500);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return badRequest('Could not read the upload. Try again.');
  }

  const title = String(form.get('title') || '').trim();
  const subject = String(form.get('subject') || '').trim();
  const startDate = String(form.get('start_date') || '').trim();
  const endDate = String(form.get('end_date') || '').trim();
  const brief = form.get('brief');
  const rubric = form.get('rubric'); // optional

  if (!title) return badRequest('Give the project a title.');
  if (title.length > MAX_TITLE) return badRequest('That title is too long.');
  if (subject.length > MAX_SUBJECT) return badRequest('That subject is too long.');
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return badRequest('Start and end dates must be real dates.');
  if (endDate <= startDate) return badRequest('The deadline needs to be after the start date.');
  if (!(brief instanceof File) || brief.size === 0) return badRequest('Upload the assignment brief as a PDF.');
  if (brief.type !== 'application/pdf') return badRequest('The brief must be a PDF.');
  if (brief.size > MAX_FILE_BYTES) return badRequest('That brief is larger than 8MB — try a smaller file.');
  if (rubric && rubric instanceof File && rubric.size > 0) {
    if (rubric.type !== 'application/pdf') return badRequest('The rubric must be a PDF.');
    if (rubric.size > MAX_FILE_BYTES) return badRequest('That rubric is larger than 8MB — try a smaller file.');
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  async function storeFile(file, purpose) {
    const fileId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || `${purpose}.pdf`;
    const key = `projects/${id}/${purpose}-${fileId}-${safeName}`;
    await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    return env.DB.prepare(
      'INSERT INTO files (id, project_id, purpose, r2_key, filename, content_type, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(fileId, id, purpose, key, file.name, file.type, file.size, now);
  }

  const stmts = [
    env.DB.prepare(
      'INSERT INTO projects (id, owner_email, title, subject, start_date, end_date, status, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, owner, title, subject, startDate, endDate, 'draft', now, now),
    await storeFile(brief, 'brief')
  ];
  if (rubric && rubric instanceof File && rubric.size > 0) {
    stmts.push(await storeFile(rubric, 'rubric'));
  }

  await env.DB.batch(stmts);

  return json({ id, title, subject, start_date: startDate, end_date: endDate, status: 'draft' }, 201);
}
