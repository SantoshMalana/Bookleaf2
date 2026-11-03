// Idempotency on the n8n side (Bubble also disables the button while a request is pending).
// Workflow static data survives between production executions of this workflow, so it can remember
// what it processed recently. A repeat of the same request_id, or the same author inside the window,
// is answered "Duplicate" without calling the AI again.
const item = $input.first().json;
const store = $getWorkflowStaticData('global');
store.recent = store.recent || {};

const now = Date.now();
const windowMs = item.settings.dedupe_window_seconds * 1000;
for (const [k, t] of Object.entries(store.recent)) if (now - t > windowMs) delete store.recent[k]; // expire old keys

const keys = [`req:${item.request_id}`, `author:${item.author_id}`];
const hit = keys.find((k) => store.recent[k]);
if (!hit) for (const k of keys) store.recent[k] = now;

return [{ json: { ...item, duplicate: Boolean(hit), duplicate_reason: hit ? (hit.startsWith('req:') ? 'same request already processed' : `a summary for this author was already requested in the last ${item.settings.dedupe_window_seconds} seconds`) : null } }];
