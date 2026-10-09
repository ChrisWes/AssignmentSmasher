// Claude Opus 5 pricing at time of writing: $5/1M input tokens, $25/1M output tokens. This is a
// rough running total for the admin screen, not a bill reconciliation -- it doesn't account for
// prompt-cache discounts (cached reads are cheaper), so the real Anthropic invoice will usually be
// a bit lower than this estimate, never higher. Update the two constants below if pricing changes.
const INPUT_PER_TOKEN = 5 / 1e6;
const OUTPUT_PER_TOKEN = 25 / 1e6;

export function estimateCostUsd(inputTokens, outputTokens) {
  return (inputTokens || 0) * INPUT_PER_TOKEN + (outputTokens || 0) * OUTPUT_PER_TOKEN;
}

// A prepared (not yet executed) statement that adds one call's usage onto a project's running
// total -- meant to go in the same env.DB.batch() as whatever else that call's endpoint is already
// writing, so the two updates land together rather than as a separate round trip.
export function recordUsageStatement(env, projectId, usage) {
  const inputTokens = (usage && usage.input_tokens) || 0;
  const outputTokens = (usage && usage.output_tokens) || 0;
  return env.DB.prepare(
    'UPDATE projects SET ai_calls = ai_calls + 1, ai_input_tokens = ai_input_tokens + ?, ai_output_tokens = ai_output_tokens + ? WHERE id = ?'
  ).bind(inputTokens, outputTokens, projectId);
}
