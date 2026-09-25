import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // chunked to avoid a call-stack blowout on large files
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// brief and rubric are { bytes: ArrayBuffer, contentType: string } | null (rubric only).
export async function analyzeBrief(apiKey, { subject, startDate, endDate, brief, rubric }) {
  const client = new Anthropic({ apiKey });

  const totalDays = Math.max(
    Math.round((toUtc(endDate) - toUtc(startDate)) / 86400000),
    1
  );

  const content = [
    {
      type: 'text',
      text: `Subject: ${subject || '(not given)'}\nStart date: ${startDate}\nDeadline: ${endDate}\nDays available: ${totalDays}\n\nHere is the assignment brief.`
    },
    {
      type: 'document',
      source: { type: 'base64', media_type: brief.contentType, data: arrayBufferToBase64(brief.bytes) }
    }
  ];
  if (rubric) {
    content.push({ type: 'text', text: 'Here is the marking rubric for the same assignment.' });
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: rubric.contentType, data: arrayBufferToBase64(rubric.bytes) }
    });
  }

  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(OutlineSchema) },
      messages: [{ role: 'user', content }]
    });
    message = await stream.finalMessage();
  } catch (err) {
    throw new Error(friendlyApiError(err));
  }

  if (message.stop_reason === 'refusal') {
    const explanation = message.stop_details?.explanation || 'no reason was given';
    throw new Error(`Claude declined to analyse this brief (${explanation}). Try rephrasing the project title or subject, or check the brief for anything unusual.`);
  }
  if (!message.parsed_output) {
    throw new Error('Claude did not return a plan in the expected shape. Try again — if it keeps happening, the brief may be too long or too unusual for this to read.');
  }
  return message.parsed_output;
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
