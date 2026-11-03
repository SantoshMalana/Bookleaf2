// Parse and fact-check the AI's email before anyone sees it. The prompt *asks* for accuracy; this node
// *checks* it: every rupee amount and date in the email must come from the facts we computed.
// Invented figures or dates fail the run (status "Failed"); softer issues become warnings.
const ctx = $('Build AI prompt').first().json;
const { facts } = ctx;
const res = $input.first().json;

const fail = (message, raw) => [{ json: { ok: false, stage: 'ai_output_check', error_message: message, raw: raw ? String(raw).slice(0, 500) : null } }];

let content = res?.choices?.[0]?.message?.content;
if (!content) return fail('The AI returned an empty response.', JSON.stringify(res));
content = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

let out;
try {
  out = JSON.parse(content);
} catch {
  const m = content.match(/\{[\s\S]*\}/); // tolerate stray text around the JSON object
  try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
}
if (!out || typeof out.subject !== 'string' || typeof out.body !== 'string') return fail('The AI response was not the expected JSON {subject, body}.', content);

// Normalise: plain text, plain spaces (reasoning models like U+202F narrow spaces), no markdown emphasis.
const clean = (s) => s.replace(/[    ]/g, ' ').replace(/[‐‑]/g, '-').replace(/\*\*|__/g, '').replace(/^#+\s*/gm, '').trim();
const subject = clean(out.subject).slice(0, 120);
let body = clean(out.body);
if (body.length < 200) return fail('The AI email body is too short to be a useful summary.', body);

// ── fact check ──
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const mi = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

const amounts = [...body.matchAll(/(?:₹|Rs\.?\s?|INR\s?)\s*([\d,]+(?:\.\d+)?)/gi)].map((m) => Math.round(Number(m[1].replace(/,/g, ''))));
const dates = new Set();
for (const m of body.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.add(isoOf(m[1], +m[2], +m[3]));
for (const m of body.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'))) dates.add(isoOf(m[3], mi(m[2]), +m[1]));
for (const m of body.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) dates.add(isoOf(m[3], mi(m[1]), +m[2]));

const allowedAmounts = new Set(facts.allowed_amounts.map((n) => Math.round(n)));
const allowedDates = new Set(facts.allowed_dates);
const badAmounts = [...new Set(amounts.filter((a) => !allowedAmounts.has(a)))];
const badDates = [...dates].filter((d) => !allowedDates.has(d));
if (badAmounts.length || badDates.length) {
  const parts = [];
  if (badAmounts.length) parts.push(`amounts not in the author's data: ${badAmounts.map((a) => '₹' + a.toLocaleString('en-IN')).join(', ')}`);
  if (badDates.length) parts.push(`dates not in the author's data: ${badDates.join(', ')}`);
  return fail(`AI email failed the fact check (${parts.join('; ')}). Nothing was sent.`, body);
}

// ── softer checks: reported to the admin, do not block ──
const warnings = [];
const lower = body.toLowerCase();
if (!lower.includes(facts.first_name.toLowerCase())) warnings.push('Greeting does not use the author\'s first name.');
for (const t of facts.published_titles) if (!lower.includes(t.toLowerCase())) warnings.push(`Published book "${t}" is not mentioned.`);
for (const t of facts.in_production_titles) if (!lower.includes(t.toLowerCase())) warnings.push(`In-production book "${t}" has no status update.`);
if (!facts.in_production_titles.length && /\bproduction\b/i.test(body)) warnings.push('Mentions production although no book is in production.');
if (facts.overdue_titles.length && !/finance/i.test(body)) warnings.push('Overdue royalty is not escalated to finance.');
if (facts.scenario === 'overdue' && /next (regular )?payout|upcoming payout/i.test(body)) warnings.push('Overdue author is pointed to a future payout cycle.');
if (/warm regards|best regards|sincerely|yours truly/i.test(body)) body = body.replace(/\n+(warm regards|best regards|sincerely|yours truly)[\s\S]*$/i, '').trim(); // we add the signature
const words = body.split(/\s+/).length;
if (words > 380) warnings.push(`Email is long (${words} words).`);

body += '\n\nWarm regards,\nThe BookLeaf Author Support Team\nBookLeaf Publishing';

return [{
  json: {
    ok: true,
    subject,
    body,
    warnings,
    words,
    model: res.model ?? ctx.settings.ai_model,
    usage: res.usage ? { prompt_tokens: res.usage.prompt_tokens, completion_tokens: res.usage.completion_tokens } : null,
  },
}];
