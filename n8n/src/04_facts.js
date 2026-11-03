// Compute every number, date and status the email may mention, deterministically, from the payload.
// The AI writes the words; this node decides the facts. Totals are recomputed here rather than trusted
// from the caller, and the payout rules come from the Assignment 1 Knowledge Base.
const item = $input.first().json;
const { settings, request: r } = item;

const DAY = 86_400_000;
const num = (v) => (v == null || v === '' ? 0 : Number(v));
// Bubble may send plain dates ("2024-07-05"), full timestamps or its own formats; normalise all to UTC midnight.
// Bubble stores a date as local midnight of the app's timezone, e.g. 15 Oct 2025 in India arrives as
// "2025-10-14T18:30:00Z" (or epoch ms). Rounding a timestamp to the nearest UTC day recovers the calendar date
// for any offset within ±12 h, so the email never shows a date one day early.
const toDate = (v) => {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z');
  const ms = /^\d{11,}$/.test(s) ? Number(s) : (/^\d{4}-\d{2}-\d{2}T/.test(s) ? Date.parse(s) : NaN);
  if (!Number.isNaN(ms)) return new Date(Math.round(ms / DAY) * DAY);
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
};
const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const STAGES = ['Manuscript Received', 'Editing', 'Cover Design', 'Typesetting', 'Proofreading', 'ISBN Assignment', 'Printing', 'Distribution Setup', 'Published & Live'];

const asOf = toDate(r.as_of_date) ?? toDate(new Date().toISOString());

// Quarterly cycle, paid within 45 days of quarter end: Q1→14 May, Q2→14 Aug, Q3→14 Nov, Q4→14 Feb (next year).
function payoutDeadlines(year) {
  const ends = [[2, 31], [5, 30], [8, 30], [11, 31]]; // Mar 31, Jun 30, Sep 30, Dec 31 (0-based months)
  return ends.map(([m, d]) => new Date(Date.UTC(year, m, d) + 45 * DAY));
}
function nextPayout(from) {
  for (const y of [from.getUTCFullYear() - 1, from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    for (const due of payoutDeadlines(y)) if (due >= from) return due;
  }
  return payoutDeadlines(from.getUTCFullYear() + 1)[3];
}

const books = (r.books ?? []).map((b) => ({
  title: String(b.title).trim(),
  book_id: b.book_id ?? null,
  status: String(b.status).trim(),
  published: String(b.status).trim() === 'Published & Live',
  publication_date: toDate(b.publication_date),
  copies_sold: num(b.copies_sold),
  royalty_earned: num(b.royalty_earned),
  royalty_paid: num(b.royalty_paid),
  royalty_pending: num(b.royalty_pending),
  last_payout_date: toDate(b.last_payout_date),
  platforms: Array.isArray(b.platforms) ? b.platforms : String(b.platforms ?? '').split(',').map((s) => s.trim()).filter(Boolean),
}));

const published = books.filter((b) => b.published);
const inProduction = books.filter((b) => !b.published);
const totals = {
  earned: published.reduce((s, b) => s + b.royalty_earned, 0),
  paid: published.reduce((s, b) => s + b.royalty_paid, 0),
  pending: published.reduce((s, b) => s + b.royalty_pending, 0),
  copies: published.reduce((s, b) => s + b.copies_sold, 0),
};
const belowThreshold = totals.pending > 0 && totals.pending < settings.payout_threshold_inr;
const next = nextPayout(asOf);

for (const b of published) {
  if (b.royalty_pending <= 0) b.state = 'paid_up';
  else if (belowThreshold) b.state = 'pending_below_threshold';
  else if (b.last_payout_date && (asOf - b.last_payout_date) / DAY > settings.overdue_after_days) b.state = 'overdue';
  else if (!b.last_payout_date && b.publication_date && (asOf - b.publication_date) / DAY > settings.overdue_after_days) b.state = 'overdue';
  else b.state = 'pending';
}
for (const b of inProduction) {
  const i = STAGES.findIndex((s) => b.status.toLowerCase().includes(s.toLowerCase()));
  b.stage = i >= 0 ? STAGES[i] : b.status.replace(/^In Production\s*-\s*/i, '');
  b.remaining_stages = i >= 0 ? STAGES.slice(i + 1) : [];
}

const overdue = published.filter((b) => b.state === 'overdue');
const onSchedule = published.filter((b) => b.state === 'pending');
const scenario = !published.length ? 'nothing_published'
  : totals.pending === 0 ? 'all_paid'
  : belowThreshold ? 'below_threshold'
  : overdue.length ? (onSchedule.length ? 'overdue_and_pending' : 'overdue')
  : 'pending_on_schedule';

// FACTS block for the prompt: one fact per line, every value already formatted the way the email should show it.
const L = [];
L.push(`AS_OF_DATE: ${iso(asOf)}`);
L.push(`AUTHOR: ${r.author.name} (first name: ${String(r.author.name).trim().split(/\s+/)[0]})`);
L.push(`SCENARIO: ${scenario}`);
for (const b of published) {
  const last = b.last_payout_date ? iso(b.last_payout_date) : 'never paid yet';
  L.push(`PUBLISHED_BOOK: "${b.title}" | ${b.copies_sold} copies sold | earned ${inr(b.royalty_earned)} | paid ${inr(b.royalty_paid)} | pending ${inr(b.royalty_pending)} | last payout ${last} | state ${b.state}`);
}
for (const b of inProduction) {
  L.push(`IN_PRODUCTION: "${b.title}" | current stage ${b.stage}${b.remaining_stages.length ? ` | still to come: ${b.remaining_stages.join(' → ')}` : ''}`);
}
L.push(`TOTALS (published books): earned ${inr(totals.earned)} | paid ${inr(totals.paid)} | pending ${inr(totals.pending)}`);
if (scenario === 'all_paid') L.push('PAYOUT: everything earned so far has been paid. Thank them; there is nothing outstanding.');
if (onSchedule.length) L.push(`NEXT_PAYOUT_DATE: ${iso(next)} — applies to the on-schedule pending amount${onSchedule.length < published.length ? ` (${onSchedule.map((b) => `"${b.title}"`).join(', ')})` : ''}. Royalties are calculated quarterly and paid within 45 days of the quarter ending.`);
if (belowThreshold) L.push(`BELOW_MINIMUM: total pending ${inr(totals.pending)} is below the ${inr(settings.payout_threshold_inr)} minimum payout, so it rolls over to the next quarter; it is paid once the account total reaches ${inr(settings.payout_threshold_inr)}. Do NOT call this overdue and do not promise a payout date for it.`);
if (overdue.length) L.push(`REQUIRED_ACTION: the pending royalty for ${overdue.map((b) => `"${b.title}"`).join(', ')} is overdue, and that is BookLeaf's responsibility. Say so plainly ("this is on us"), say it has been escalated to our finance team, and promise an update within 48 hours. Do NOT tell the author to wait for a future payout date for these books.`);
L.push('NOT_IN_DATA: bank account details, per-platform sales breakdown, printing/commission/shipping costs per copy');

// Values the email is allowed to state; anything else is flagged by the fact-check node.
const amounts = new Set([totals.earned, totals.paid, totals.pending, settings.payout_threshold_inr]);
for (const b of published) [b.royalty_earned, b.royalty_paid, b.royalty_pending].forEach((v) => amounts.add(Math.round(v)));
const dates = new Set([iso(asOf)]);
if (onSchedule.length) dates.add(iso(next));
for (const b of books) [b.publication_date, b.last_payout_date].forEach((d) => d && dates.add(iso(d)));

return [{
  json: {
    ...item,
    facts: {
      as_of_date: iso(asOf),
      scenario,
      first_name: String(r.author.name).trim().split(/\s+/)[0],
      totals,
      next_payout_date: onSchedule.length ? iso(next) : null,
      overdue_titles: overdue.map((b) => b.title),
      in_production_titles: inProduction.map((b) => b.title),
      published_titles: published.map((b) => b.title),
      lines: L,
      allowed_amounts: [...amounts],
      allowed_dates: [...dates],
    },
  },
}];
