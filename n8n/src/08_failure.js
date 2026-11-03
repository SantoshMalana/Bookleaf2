// One place that turns any failure into the same "Failed" response, so Bubble always gets an answer
// (no spinner forever) and the Notification Log records why. Reached from: invalid payload, duplicate,
// the AI call's error output, and the fact-check rejecting the email.
const ctx = $('Validate payload').first().json;
const input = $input.first().json;

let status = 'Failed';
let stage;
let message;
let httpCode = 200; // business failures are a normal answer for Bubble to log; only malformed requests get 4xx

if (input.duplicate) {
  status = 'Duplicate';
  stage = 'dedupe';
  message = `Not sent again: ${input.duplicate_reason}.`;
} else if (input.ok === false && input.errors) {
  stage = 'validation';
  message = `Invalid request from Bubble: ${input.errors.join('; ')}`;
  httpCode = 400;
} else if (input.stage === 'ai_output_check') {
  stage = 'ai_output_check';
  message = input.error_message;
} else {
  // Error output of the HTTP Request node (AI API down, timeout, 401/429/5xx after retries).
  const e = input.error ?? input;
  const code = e.httpCode ?? e.status ?? e.cause?.status ?? null;
  stage = 'ai_api';
  message = `AI service call failed${code ? ` (HTTP ${code})` : ''}: ${String(e.message ?? e.description ?? 'unknown error').slice(0, 200)}`;
}

// A failed attempt must not block a retry: release the per-author de-duplication lock so the admin can try
// again straight away (the request_id stays recorded, so the very same request is still never processed twice).
if (stage === 'ai_api' || stage === 'ai_output_check') {
  const store = $getWorkflowStaticData('global');
  if (store.recent && ctx?.author_id) delete store.recent[`author:${ctx.author_id}`];
}

return [{
  json: {
    http_code: httpCode,
    response: {
      status,
      request_id: ctx?.request_id ?? null,
      author_id: ctx?.author_id ?? null,
      stage,
      error_message: message,
      completed_at: new Date().toISOString(),
    },
  },
}];
