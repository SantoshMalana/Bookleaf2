// End-to-end tests for the n8n workflow, run against a real n8n with the workflow active and tools/ai_stub.mjs
// standing in for the AI provider.
//   N8N_URL=http://localhost:5678/webhook/bookleaf/royalty-summary WEBHOOK_KEY=... node tools/test_workflow.mjs
import { payloadFor } from './payload.mjs';

const URL_ = process.env.N8N_URL ?? 'http://localhost:5678/webhook/bookleaf/royalty-summary';
const KEY = process.env.WEBHOOK_KEY ?? 'test-webhook-key';
let passed = 0, failed = 0;

async function call(body, key = KEY) {
  const t = Date.now();
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'X-BookLeaf-Key': key } : {}) }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, ms: Date.now() - t };
}
function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}  ${info}`); }
}
// Each run uses its own author ids, so the 2-minute de-duplication window never links two separate test runs.
const RUN = Date.now().toString(36);
const id = (s) => `${s}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

console.log('Every author in the dataset (as of 2025-12-15)');
const expectations = {
  AUTH001: ['₹3,570', '14 February 2026'],
  AUTH002: ['finance', '₹13,024'],
  AUTH003: ['finance', '₹2,546'],
  AUTH005: ['₹3,055'],
  AUTH007: ['Midnight in Mysore', 'production'],
  AUTH008: ['has been paid'],
  AUTH009: ['₹1,000 minimum', 'production'],
};
for (let i = 1; i <= 10; i++) {
  const a = `AUTH${String(i).padStart(3, '0')}`;
  const r = await call(payloadFor(a, id(a), '2025-12-15', { author_id: `${a}-${RUN}` }));
  const ok = r.status === 200 && r.json?.status === 'Success';
  check(`${a} → Success in ${r.ms} ms`, ok, r.text.slice(0, 300));
  for (const must of expectations[a] ?? []) if (must) check(`${a} email mentions "${must}"`, r.json?.body?.includes(must), (r.json?.body ?? '').slice(0, 400));
  if (ok) check(`${a} has no fact-check warnings`, (r.json.warnings ?? []).length === 0, JSON.stringify(r.json.warnings));
  if (a === 'AUTH003') console.log('\n--- sample email (stub AI) ---\n' + r.json?.subject + '\n\n' + r.json?.body + '\n------------------------------\n');
}

console.log('Idempotency');
const p1 = payloadFor('AUTH004', id('dup'), '2025-12-15', { author_id: `T-DUP-${RUN}` });
const first = await call(p1);
check('first request succeeds', first.json?.status === 'Success', first.text.slice(0, 200));
const again = await call(p1);
check('same request_id again → Duplicate', again.json?.status === 'Duplicate' && /same request/.test(again.json?.error_message), again.text.slice(0, 200));
const sameAuthor = await call(payloadFor('AUTH004', id('dup2'), '2025-12-15', { author_id: `T-DUP-${RUN}` }));
check('same author within the window → Duplicate', sameAuthor.json?.status === 'Duplicate', sameAuthor.text.slice(0, 200));

console.log('Security & validation');
const noKey = await call(payloadFor('AUTH006', id('nokey')), null);
check(`no key → rejected (${noKey.status})`, noKey.status === 401 || noKey.status === 403, noKey.text.slice(0, 120));
const badKey = await call(payloadFor('AUTH006', id('badkey')), 'wrong');
check(`wrong key → rejected (${badKey.status})`, badKey.status === 401 || badKey.status === 403, badKey.text.slice(0, 120));
const invalid = await call({ request_id: id('bad'), author: { author_id: 'X' } });
check('missing fields → 400 Failed (validation)', invalid.status === 400 && invalid.json?.status === 'Failed' && invalid.json?.stage === 'validation', invalid.text.slice(0, 200));

console.log('AI failure modes');
const down = await call(payloadFor('AUTH010', id('down'), '2025-12-15', { author_id: `T-500-${RUN}`, name: 'Test Fail500' }));
check('AI provider 500 → Failed (ai_api), answered not hung', down.json?.status === 'Failed' && down.json?.stage === 'ai_api', down.text.slice(0, 200));
const retry = await call(payloadFor('AUTH010', id('down2'), '2025-12-15', { author_id: `T-500-${RUN}`, name: 'Test Fail500' }));
check('a retry right after a failure is processed again (not Duplicate)', retry.json?.status === 'Failed' && retry.json?.stage === 'ai_api', retry.text.slice(0, 200));
const invent = await call(payloadFor('AUTH010', id('inv'), '2025-12-15', { author_id: `T-INV-${RUN}`, name: 'Test Invent' }));
check('AI invents ₹5,000 → Failed (fact check)', invent.json?.status === 'Failed' && /₹5,000/.test(invent.json?.error_message), invent.text.slice(0, 300));
const garbage = await call(payloadFor('AUTH010', id('garb'), '2025-12-15', { author_id: `T-GARB-${RUN}`, name: 'Test Garbage' }));
check('AI returns non-JSON → Failed (fact check)', garbage.json?.status === 'Failed' && garbage.json?.stage === 'ai_output_check', garbage.text.slice(0, 200));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
