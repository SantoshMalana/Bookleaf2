// Validate the payload Bubble sent. Never trust a webhook body: check every field we rely on.
const { settings, request: r, received_at } = $input.first().json;
const errors = [];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isDate = (v) => v == null || v === '' || !Number.isNaN(Date.parse(v));

if (!r || typeof r !== 'object') errors.push('body must be a JSON object');
if (!r?.request_id) errors.push('request_id is required (the Notification Log row id)');
if (!r?.author?.author_id) errors.push('author.author_id is required');
if (!r?.author?.name) errors.push('author.name is required');
if (!Array.isArray(r?.books)) errors.push('books must be an array');
if (r?.as_of_date && !isDate(r.as_of_date)) errors.push('as_of_date must be a date');

for (const [i, b] of (Array.isArray(r?.books) ? r.books : []).entries()) {
  if (!b?.title) errors.push(`books[${i}].title is required`);
  if (!b?.status) errors.push(`books[${i}].status is required`);
  for (const f of ['copies_sold', 'royalty_earned', 'royalty_paid', 'royalty_pending']) {
    if (b?.[f] != null && b[f] !== '' && !isNum(Number(b[f]))) errors.push(`books[${i}].${f} must be a number`);
  }
  for (const f of ['publication_date', 'last_payout_date']) if (!isDate(b?.[f])) errors.push(`books[${i}].${f} must be a date`);
}

return [{
  json: {
    ok: errors.length === 0,
    errors,
    settings,
    request: r,
    received_at,
    request_id: r?.request_id ?? null,
    author_id: r?.author?.author_id ?? null,
  },
}];
