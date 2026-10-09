import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Cloudflare Pages' Functions bundler cannot resolve @anthropic-ai/sdk's deep subpath exports
// (helpers/zod, lib/transform-json-schema — both failed to resolve at build time, even though
// they work fine under `wrangler pages dev` locally). Only the package's root import is reliable
// there, so this builds the same { type: 'json_schema', schema, parse } shape that
// zodOutputFormat() would, using only that root import plus zod's own toJSONSchema. The transform
// below mirrors @anthropic-ai/sdk's transformJSONSchema exactly (same strict-schema rules), so the
// request Claude sees is identical to what the SDK helper would have sent.

export const MODEL = 'claude-opus-5';

export const OutlineSchema = z.object({
  deliverables: z.array(z.object({
    title: z.string(),
    format: z.string().describe('What form it takes and any stated length or duration, e.g. "2,500-word report" or "10-minute presentation".'),
    description: z.string()
  })).min(1),
  assessment_criteria: z.array(z.object({
    criterion: z.string(),
    weight: z.string().nullable().describe('The stated weighting, e.g. "30%", or null if the source does not give one — never guess a number.')
  })),
  ambiguities: z.array(z.string()).describe('Things the brief leaves unclear or unstated, worth checking with the tutor. Empty if genuinely nothing is unclear.'),
  milestones: z.array(z.object({
    title: z.string(),
    goal: z.string().describe('One encouraging line: what "done" looks like for this milestone.'),
    duration_days: z.number().int().min(1).max(60).describe('Best estimate of the days of focused work this milestone needs.')
  })).min(3).max(12)
});

// The system prompt is what keeps this a coach rather than a ghostwriter. Read it before changing
// anything else in this file — the milestone shape it insists on (process stages, never a slice of
// the finished document) is the whole point of the tool.
const SYSTEM_PROMPT = `You are a study-skills coach helping a college student plan a piece of coursework. You are not a ghostwriter: you must never produce text, code, or any other content the student could submit as their own work. Your job is to help them understand what is being asked, and to break it into a realistic, logical sequence of milestones they work through themselves.

You are given the assignment brief, and sometimes a marking rubric for the same assignment, as documents, along with the subject and how many days the student has from the start date to the deadline.

Do this:
1. List the concrete deliverables: what has to be handed in and in what form (word count, file type, duration, number of slides, and so on), read precisely from the brief.
2. List the assessment criteria. Use the rubric if one is given; otherwise use your best reading of the brief. Give the weighting only if the source states it — never guess a number.
3. Flag anything the brief leaves unclear or unstated, so the student can check it with their tutor instead of guessing. Say so plainly if nothing is unclear; do not invent an ambiguity to fill the list.
4. Break the work into milestones running from the start date to the deadline. Each milestone is a stage of the process — for example understanding the brief, research, planning the structure, a first draft, getting feedback, revising, and a final check against the criteria before submission — never a slice of the finished document. A milestone that amounts to "write the report" or "do the assignment" is not a plan, it is the whole task restated; break it down further instead.
5. Give each milestone a short, encouraging one-line goal and your best estimate of the focused days of work it needs. Be realistic about a student juggling several modules and a life outside them — do not assume full days of uninterrupted work.

If a rubric was provided, check before you finish that the milestones between them touch on every criterion in it.`;

export const StepsSchema = z.object({
  steps: z.array(z.string()).min(3).max(10)
});

// Deliberately a separate, narrower prompt from SYSTEM_PROMPT above, not a shared one — this call
// is scoped to a single already-agreed milestone, not the whole assignment, so it doesn't need
// (and shouldn't repeat) the instructions about deliverables, criteria or sizing the plan.
const STEPS_SYSTEM_PROMPT = `You are a study-skills coach helping a college student work through one stage of a piece of coursework. You are not a ghostwriter: you must never produce text, code, or any other content the student could submit as their own work.

You are given the assignment brief (and sometimes a marking rubric), the deliverables and assessment criteria already identified for the whole assignment, and one milestone from the student's plan — its title and goal. Turn that single milestone into a short sequence of concrete steps the student can work through and tick off, in the order they would actually do them.

Each step should say what to physically do — draft a rough outline, list three claims and find a source for each, read back through what you have and mark what is missing — never what the finished work should say. Keep it to around 4 to 8 steps, each short enough to read in one breath. If this milestone is the final check or submission stage, make checking the work against the assessment criteria one of the steps.`;

const BAND = ['needs_work', 'on_track', 'strong', 'excellent'];

export const FeedbackSchema = z.object({
  overall_band: z.enum(BAND).describe('A rough overall steer only, never a precise grade.'),
  overall_summary: z.string().describe('Two or three sentences: the main impression, in plain language.'),
  deliverable_checks: z.array(z.object({
    requirement: z.string().describe('One concrete, checkable requirement from the brief — word count, format, required sections, number of sources, and so on.'),
    met: z.enum(['yes', 'no', 'unclear']),
    note: z.string().describe('One line explaining the check — state the actual word count found, for example.')
  })).min(1),
  criteria: z.array(z.object({
    criterion: z.string(),
    band: z.enum(BAND),
    strengths: z.array(z.string()).describe('What is genuinely working in this piece of work, specific to it — not generic praise.'),
    gaps: z.array(z.string()).describe('What is missing, thin, or unclear against this criterion, described in general terms only — never a rewritten or suggested replacement sentence.')
  })).min(1),
  top_actions: z.array(z.string()).min(1).max(3).describe('The highest-value things to fix before submitting, in priority order.')
});

// The sharpest boundary in this whole app: this reads the student's own real, assessed work, so
// the usual "never ghostwrite" rule isn't enough on its own — it must never rewrite or suggest
// replacement text for any part of what the student already wrote, only describe what's there.
const FEEDBACK_SYSTEM_PROMPT = `You are a study-skills coach giving a college student feedback on a draft before they submit it, checked against the assignment brief and marking rubric. You are not a marker and not a ghostwriter.

Never rewrite, draft, or suggest replacement text for any part of the student's work, in any amount — not a sentence, not a heading, not a single phrase. Describe what is missing or weak in general terms only, and let the student fix it themselves. If a requirement is unmet, say what is missing, never what to write instead.

You are given the assignment brief, sometimes a marking rubric, the deliverables and assessment criteria already identified for this assignment, and the student's draft or final document as a document to read.

Do this:
1. Check the draft against each concrete, checkable requirement from the brief — word count, format, required sections, number of sources, and so on. Say whether each is met, not met, or unclear, with one line explaining the check.
2. For each assessment criterion, give specific strengths genuinely present in this piece of work, and specific gaps — what is missing, thin, or unclear against that criterion.
3. Give each criterion, and the work overall, a rough band: needs_work, on_track, strong, or excellent. This is a rough steer, not a real mark — a real marker may see it differently, and markers can disagree with each other too. Never imply more precision than that, and never state or imply a percentage or a degree classification.
4. End with the one to three highest-value things to fix before submitting, in priority order.

Be honest rather than encouraging for its own sake — a student about to submit needs to know what is actually wrong, not to feel good. But be specific and constructive: every gap should be something the student can act on themselves.`;

const SUPPORTED_STRING_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid'
]);

function pop(obj, key) {
  const v = obj[key];
  delete obj[key];
  return v;
}

// Mirrors @anthropic-ai/sdk's internal transformJSONSchema — see the comment at the top of this
// file for why this is vendored rather than imported.
function strictJsonSchema(jsonSchema) {
  const strict = {};
  const defs = pop(jsonSchema, '$defs');
  if (defs !== undefined) {
    const strictDefs = {};
    strict.$defs = strictDefs;
    for (const [name, defSchema] of Object.entries(defs)) strictDefs[name] = strictJsonSchema(defSchema);
  }
  const ref = pop(jsonSchema, '$ref');
  if (ref !== undefined) { strict.$ref = ref; return strict; }

  const type = pop(jsonSchema, 'type');
  const anyOf = pop(jsonSchema, 'anyOf');
  const oneOf = pop(jsonSchema, 'oneOf');
  const allOf = pop(jsonSchema, 'allOf');
  if (Array.isArray(anyOf)) strict.anyOf = anyOf.map(strictJsonSchema);
  else if (Array.isArray(oneOf)) strict.anyOf = oneOf.map(strictJsonSchema);
  else if (Array.isArray(allOf)) strict.allOf = allOf.map(strictJsonSchema);
  else {
    if (type === undefined) throw new Error('JSON schema must have a type defined if anyOf/oneOf/allOf are not used');
    strict.type = type;
  }

  const description = pop(jsonSchema, 'description');
  if (description !== undefined) strict.description = description;
  const title = pop(jsonSchema, 'title');
  if (title !== undefined) strict.title = title;

  if (type === 'object') {
    const properties = pop(jsonSchema, 'properties') || {};
    strict.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, strictJsonSchema(v)]));
    pop(jsonSchema, 'additionalProperties');
    strict.additionalProperties = false;
    const required = pop(jsonSchema, 'required');
    if (required !== undefined) strict.required = required;
  } else if (type === 'string') {
    const format = pop(jsonSchema, 'format');
    if (format !== undefined && SUPPORTED_STRING_FORMATS.has(format)) strict.format = format;
    else if (format !== undefined) jsonSchema.format = format;
  } else if (type === 'array') {
    const items = pop(jsonSchema, 'items');
    if (items !== undefined) strict.items = strictJsonSchema(items);
    const minItems = pop(jsonSchema, 'minItems');
    if (minItems === 0 || minItems === 1) strict.minItems = minItems;
    else if (minItems !== undefined) jsonSchema.minItems = minItems;
  }

  if (Object.keys(jsonSchema).length > 0) {
    strict.description = (strict.description ? strict.description + '\n\n' : '') +
      '{' + Object.entries(jsonSchema).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') + '}';
  }
  return strict;
}

// Equivalent to zodOutputFormat(zodObject) from @anthropic-ai/sdk/helpers/zod.
function jsonSchemaOutputFormat(zodObject) {
  const schema = strictJsonSchema(JSON.parse(JSON.stringify(z.toJSONSchema(zodObject, { reused: 'ref' }))));
  return {
    type: 'json_schema',
    schema,
    parse(content) {
      let parsed;
      try { parsed = JSON.parse(content); }
      catch (e) { throw new Error('Failed to parse structured output as JSON: ' + e.message); }
      const result = zodObject.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues.slice(0, 5).map((i) => '  - ' + i.path.join('.') + ': ' + i.message).join('\n');
        throw new Error('Failed to parse structured output:\n' + issues);
      }
      return result.data;
    }
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // chunked to avoid a call-stack blowout on large files
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Builds the lead text block plus the brief (and optional rubric, and optional one further
// labelled document) document blocks — the part every call to Claude in this file shares. brief,
// rubric and extra.file are { bytes: ArrayBuffer, contentType } (rubric and extra may be omitted).
function documentContent(leadText, brief, rubric, extra) {
  const content = [
    { type: 'text', text: leadText },
    { type: 'document', source: { type: 'base64', media_type: brief.contentType, data: arrayBufferToBase64(brief.bytes) } }
  ];
  if (rubric) {
    content.push({ type: 'text', text: 'Here is the marking rubric for the same assignment.' });
    content.push({ type: 'document', source: { type: 'base64', media_type: rubric.contentType, data: arrayBufferToBase64(rubric.bytes) } });
  }
  if (extra) {
    content.push({ type: 'text', text: extra.label });
    content.push({ type: 'document', source: { type: 'base64', media_type: extra.file.contentType, data: arrayBufferToBase64(extra.file.bytes) } });
  }
  return content;
}

// Shared request/error/refusal handling for every structured-output call in this file.
async function callClaude(apiKey, { system, content, format }) {
  const client = new Anthropic({ apiKey });
  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format },
      messages: [{ role: 'user', content }]
    });
    message = await stream.finalMessage();
  } catch (err) {
    throw new Error(friendlyApiError(err));
  }

  if (message.stop_reason === 'refusal') {
    const explanation = message.stop_details?.explanation || 'no reason was given';
    throw new Error(`Claude declined this request (${explanation}). Try rephrasing the project title or subject, or check the brief for anything unusual.`);
  }
  if (!message.parsed_output) {
    throw new Error('Claude did not return a result in the expected shape. Try again — if it keeps happening, the brief may be too long or too unusual for this to read.');
  }
  // usage is only ever returned alongside a successful parsed_output — a refusal or a malformed
  // response throws above instead of reaching here, so those (rare) cases go untracked rather than
  // attaching usage to a thrown error. This is a rough running total for the admin screen, not a
  // bill reconciliation, and that gap is small in practice.
  return { output: message.parsed_output, usage: message.usage || {} };
}

// brief and rubric are { bytes: ArrayBuffer, contentType: string } | null (rubric only).
export async function analyzeBrief(apiKey, { subject, startDate, endDate, brief, rubric }) {
  const totalDays = Math.max(
    Math.round((toUtc(endDate) - toUtc(startDate)) / 86400000),
    1
  );

  const content = documentContent(
    `Subject: ${subject || '(not given)'}\nStart date: ${startDate}\nDeadline: ${endDate}\nDays available: ${totalDays}\n\nHere is the assignment brief.`,
    brief, rubric
  );

  const result = await callClaude(apiKey, { system: SYSTEM_PROMPT, content, format: jsonSchemaOutputFormat(OutlineSchema) });
  return { outline: result.output, usage: result.usage };
}

// Expands one already-agreed milestone into a short, concrete checklist. deliverables and
// assessmentCriteria are the whole assignment's, passed for context; milestone is { title, goal }.
export async function generateMilestoneSteps(apiKey, { subject, deliverables, assessmentCriteria, milestone, brief, rubric }) {
  const deliverableLines = (deliverables || []).map((d) => `- ${d.title} (${d.format})`).join('\n') || '(none recorded)';
  const criteriaLines = (assessmentCriteria || []).map((c) => `- ${c.criterion}${c.weight ? ' (' + c.weight + ')' : ''}`).join('\n') || '(none separately identified)';

  const content = documentContent(
    `Subject: ${subject || '(not given)'}\n\n` +
    `Deliverables for the whole assignment:\n${deliverableLines}\n\n` +
    `Assessment criteria for the whole assignment:\n${criteriaLines}\n\n` +
    `The milestone to turn into steps:\nTitle: ${milestone.title}\nGoal: ${milestone.goal}\n\n` +
    `Here is the assignment brief, for context.`,
    brief, rubric
  );

  const result = await callClaude(apiKey, { system: STEPS_SYSTEM_PROMPT, content, format: jsonSchemaOutputFormat(StepsSchema) });
  return { steps: result.output.steps, usage: result.usage };
}

// Checks a draft or final document against the brief, rubric and already-identified deliverables
// and criteria. submission is { bytes: ArrayBuffer, contentType } — the student's own document.
export async function checkSubmission(apiKey, { subject, deliverables, assessmentCriteria, submission, brief, rubric }) {
  const deliverableLines = (deliverables || []).map((d) => `- ${d.title} (${d.format})`).join('\n') || '(none recorded)';
  const criteriaLines = (assessmentCriteria || []).map((c) => `- ${c.criterion}${c.weight ? ' (' + c.weight + ')' : ''}`).join('\n') || '(none separately identified)';

  const content = documentContent(
    `Subject: ${subject || '(not given)'}\n\n` +
    `Deliverables for this assignment:\n${deliverableLines}\n\n` +
    `Assessment criteria:\n${criteriaLines}\n\n` +
    `Here is the assignment brief.`,
    brief, rubric,
    { label: 'Here is the student’s draft or final document to check.', file: submission }
  );

  const result = await callClaude(apiKey, { system: FEEDBACK_SYSTEM_PROMPT, content, format: jsonSchemaOutputFormat(FeedbackSchema) });
  return { feedback: result.output, usage: result.usage };
}

function toUtc(isoDate) {
  return new Date(isoDate + 'T00:00:00Z');
}

// Turns the SDK's typed exceptions into something worth showing on screen. Most specific first —
// see shared/error-codes.md in the claude-api skill for why a single broad catch loses this.
function friendlyApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Claude API key is missing or invalid. Whoever manages this site needs to check the ANTHROPIC_API_KEY setting in Cloudflare.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'This Claude API key does not have permission for this request. Check the key’s access in the Anthropic console.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Claude is rate-limited right now. Wait a minute and try again.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    return 'Claude could not process this brief (' + err.message + '). It may be too long, corrupted, or not a real PDF.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Claude. Check the connection and try again.';
  }
  if (err instanceof Anthropic.APIError) {
    return 'Claude returned an error (' + (err.status || '?') + '): ' + err.message;
  }
  return 'Something went wrong talking to Claude: ' + (err && err.message ? err.message : String(err));
}
