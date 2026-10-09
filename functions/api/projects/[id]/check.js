import { ownerEmail, unauthorized } from '../../../lib/auth.js';
import { checkSubmission } from '../../../lib/claude.js';
import { recordUsageStatement } from '../../../lib/usage.js';

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
  if (!row.outline_json) return json({ error: 'Read the brief and build a plan first — checking a draft needs the deliverables and criteria to check it against.' }, 400);
  if (row.feedback_status === 'checking') return json({ error: 'Already checking this draft.' }, 409);

  const files = (await env.DB.prepare('SELECT * FROM files WHERE project_id = ?').bind(row.id).all()).results;
  const briefFile = files.find((f) => f.purpose === 'brief');
  const rubricFile = files.find((f) => f.purpose === 'rubric');
  const submissionFile = files.find((f) => f.purpose === 'submission');
  if (!briefFile) return json({ error: 'The original brief is missing for this project.' }, 400);
  if (!submissionFile) return json({ error: 'Upload your draft or final document first.' }, 400);

  await env.DB.prepare('UPDATE projects SET feedback_status = ?, feedback_error = NULL, updated_at = ? WHERE id = ?')
    .bind('checking', Date.now(), row.id).run();

  try {
    const briefObj = await env.FILES.get(briefFile.r2_key);
    if (!briefObj) throw new Error('The brief file has gone missing from storage. Try creating the project again.');
    const brief = { bytes: await briefObj.arrayBuffer(), contentType: briefFile.content_type };

    let rubric = null;
    if (rubricFile) {
      const rubricObj = await env.FILES.get(rubricFile.r2_key);
      if (rubricObj) rubric = { bytes: await rubricObj.arrayBuffer(), contentType: rubricFile.content_type };
    }

    const submissionObj = await env.FILES.get(submissionFile.r2_key);
    if (!submissionObj) throw new Error('Your uploaded document has gone missing from storage — upload it again.');
    const submission = { bytes: await submissionObj.arrayBuffer(), contentType: submissionFile.content_type };

    const outline = JSON.parse(row.outline_json);
    const { feedback, usage } = await checkSubmission(env.ANTHROPIC_API_KEY, {
      subject: row.subject,
      deliverables: outline.deliverables,
      assessmentCriteria: outline.assessment_criteria,
      submission, brief, rubric
    });

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('UPDATE projects SET feedback_status = ?, feedback_json = ?, feedback_error = NULL, updated_at = ? WHERE id = ?')
        .bind('ready', JSON.stringify(feedback), now, row.id),
      recordUsageStatement(env, row.id, usage)
    ]);

    return json({ feedback });
  } catch (err) {
    const message = (err && err.message) ? err.message : 'Something went wrong checking this draft.';
    await env.DB.prepare('UPDATE projects SET feedback_status = ?, feedback_error = ?, updated_at = ? WHERE id = ?')
      .bind('failed', message, Date.now(), row.id).run();
    return json({ error: message }, 502);
  }
}
