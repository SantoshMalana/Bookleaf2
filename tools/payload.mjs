// Builds the exact JSON body the Bubble app sends to n8n, for one author of the sample dataset.
//   node tools/payload.mjs AUTH003 [request_id] [as_of_date]
// Used by the workflow tests and handy for "Execute workflow" testing inside n8n.
import fs from 'node:fs';

export function payloadFor(authorId, requestId = `test-${Date.now()}`, asOf = '2025-12-15', overrides = {}) {
  const data = JSON.parse(fs.readFileSync(new URL('../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
  const a = data.authors.find((x) => x.author_id === authorId);
  if (!a) throw new Error(`unknown author ${authorId}`);
  return {
    request_id: requestId,
    as_of_date: asOf,
    author: { author_id: overrides.author_id ?? a.author_id, name: overrides.name ?? a.name, email: a.email, city: a.city },
    books: a.books.map((b) => ({
      book_id: b.book_id,
      title: b.title,
      status: b.status,
      isbn: b.isbn,
      publication_date: b.publication_date ?? '',
      copies_sold: b.total_copies_sold,
      royalty_per_copy: b.author_royalty_per_copy ?? '',
      royalty_earned: b.total_royalty_earned,
      royalty_paid: b.royalty_paid,
      royalty_pending: b.royalty_pending,
      last_payout_date: b.last_royalty_payout_date ?? '',
      platforms: b.available_on.join(', '),
    })),
  };
}

if (process.argv[1]?.endsWith('payload.mjs')) {
  console.log(JSON.stringify(payloadFor(process.argv[2] ?? 'AUTH003', process.argv[3], process.argv[4]), null, 2));
}
