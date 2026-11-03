// A fake OpenAI-compatible endpoint for testing the n8n workflow offline.
//   node tools/ai_stub.mjs 9911
// Behaviour is chosen per request by the author's name in the FACTS, so one stub covers every test:
//   name contains "Fail500"  → HTTP 500 (simulates the AI provider being down)
//   name contains "Invent"   → an email quoting an amount that is not in the data (must be rejected)
//   name contains "Garbage"  → non-JSON content (must be rejected)
//   otherwise                → a well-formed email built only from the FACTS lines
import http from 'node:http';

const port = Number(process.argv[2] ?? 9911);
let calls = 0;

function emailFrom(facts) {
  const get = (k) => facts.filter((l) => l.startsWith(k + ':')).map((l) => l.slice(k.length + 1).trim());
  const first = /first name: ([^)]+)/.exec(get('AUTHOR')[0] ?? '')?.[1] ?? 'there';
  const lines = [`Hi ${first},`, '', 'Here is your latest royalty summary from BookLeaf.', ''];
  for (const b of get('PUBLISHED_BOOK')) {
    const [title, sold, earned, paid, pending] = b.split('|').map((s) => s.trim());
    lines.push(`- ${title}: ${sold}, ${earned}, ${paid}, ${pending}.`);
  }
  const totals = get('TOTALS (published books)')[0];
  if (totals) lines.push('', `Across your published books you have ${totals}.`);
  const next = get('NEXT_PAYOUT_DATE')[0];
  if (next) {
    const d = new Date(next.slice(0, 10) + 'T00:00:00Z');
    lines.push(`Royalties are paid quarterly within 45 days of the quarter ending, so your next payout is due by ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}.`);
  }
  if (get('REQUIRED_ACTION').length) lines.push('Part of this payment is overdue and this is on us. We have escalated it to our finance team and will update you within 48 hours.');
  if (get('BELOW_MINIMUM').length) lines.push('Your pending balance is below the ₹1,000 minimum payout, so it rolls over to the next quarter.');
  if (get('PAYOUT').length) lines.push('Everything you have earned so far has been paid. Thank you for being with us!');
  for (const p of get('IN_PRODUCTION').filter((x) => x !== 'none')) lines.push(`Your book ${p.split('|')[0].trim()} is moving through production (${p.split('|')[1]?.trim()}).`);
  lines.push('', 'If you would like a line-by-line breakdown, just reply to this email and we will send it over.');
  return { subject: `Your BookLeaf royalty summary, ${first}`, body: lines.join('\n') };
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    calls++;
    if (req.url === '/calls') { res.end(JSON.stringify({ calls })); return; }
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ')) { res.writeHead(401).end('{"error":"missing key"}'); return; }
    const body = JSON.parse(raw || '{}');
    const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
    const facts = user.split('\n');
    const author = facts.find((l) => l.startsWith('AUTHOR:')) ?? '';
    if (author.includes('Fail500')) { res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":{"message":"upstream exploded"}}'); return; }
    let content;
    if (author.includes('Garbage')) content = 'Sorry, I cannot help with that.';
    else {
      const e = emailFrom(facts);
      if (author.includes('Invent')) e.body += '\nGood news: we are also adding a ₹5,000 bonus to your account.';
      content = JSON.stringify(e);
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id: 'stub', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 900, completion_tokens: 300 },
    }));
  });
}).listen(port, () => console.log(`AI stub on :${port}`));
