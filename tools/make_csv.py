"""Turns bookleaf_sample_data.json into the CSV files Bubble's App Data uploader expects.

Run from the repo root:  python3 tools/make_csv.py [--as-of 2025-12-15]

Statuses are computed with exactly the same rules the Bubble "Recalculate statuses" workflow and the
n8n workflow use, so the imported data is correct on day one and can be recomputed in-app later.
"""
import csv
import json
import sys
from datetime import date

AS_OF = date.fromisoformat(sys.argv[sys.argv.index('--as-of') + 1]) if '--as-of' in sys.argv else date(2025, 12, 15)
THRESHOLD = 1000      # Knowledge Base: minimum payout, applied to the author's whole account
OVERDUE_DAYS = 90     # Assignment 2 brief: red badge rule

data = json.load(open('data/bookleaf_sample_data.json', encoding='utf-8'))


def d(s):
    return date.fromisoformat(s) if s else None


def book_status(b, account_pending):
    """Paid up (green) / Pending (yellow) / Overdue (red) / In production (grey)."""
    if b['status'] != 'Published & Live':
        return 'In production'
    if b['royalty_pending'] <= 0:
        return 'Paid up'
    if account_pending < THRESHOLD:
        return 'Pending'  # below the ₹1,000 minimum: rolls over to the next quarter, so it is not overdue
    last, pub = d(b['last_royalty_payout_date']), d(b['publication_date'])
    if last and (AS_OF - last).days > OVERDUE_DAYS:
        return 'Overdue'
    if not last and pub and (AS_OF - pub).days > OVERDUE_DAYS:
        return 'Overdue'
    return 'Pending'


RANK = {'Overdue': 3, 'Pending': 2, 'Paid up': 1, 'In production': 0}
AUTHOR_STATUS = {3: 'Overdue', 2: 'Pending', 1: 'Fully paid', 0: 'No royalties yet'}

authors, books, payouts = [], [], []
for a in data['authors']:
    pending = sum(b['royalty_pending'] for b in a['books'])
    worst = 0
    for b in a['books']:
        st = book_status(b, pending)
        worst = max(worst, RANK[st])
        books.append({
            'book_id': b['book_id'],
            'title': b['title'],
            'author': a['author_id'],          # link field: match Author by author_id in the uploader
            'author_code': a['author_id'],     # plain-text copy, used by the "Link books" fallback
            'author_email': a['email'],        # denormalised for a one-hop privacy rule (see docs)
            'isbn': b['isbn'],
            'genre': b['genre'],
            'status': b['status'],
            'is_published': 'yes' if b['status'] == 'Published & Live' else 'no',
            'publication_date': b['publication_date'] or '',
            'mrp': '' if b['mrp'] is None else b['mrp'],
            'royalty_per_copy': '' if b['author_royalty_per_copy'] is None else b['author_royalty_per_copy'],
            'copies_sold': b['total_copies_sold'],
            'royalty_earned': b['total_royalty_earned'],
            'royalty_paid': b['royalty_paid'],
            'royalty_pending': b['royalty_pending'],
            'last_payout_date': b['last_royalty_payout_date'] or '',
            'print_partner': b['print_partner'] or '',
            'platforms': ', '.join(b['available_on']),
            'royalty_status': st,
        })
        if b['last_royalty_payout_date']:
            payouts.append({
                'payout_id': f"PAY-{b['book_id']}",
                'book': b['book_id'],
                'author': a['author_id'],
                'author_email': a['email'],
                'payout_date': b['last_royalty_payout_date'],
                'amount_paid_to_date': b['royalty_paid'],
                'note': 'Latest payout on record. The dataset holds the cumulative amount paid and the latest payout date only.',
            })
    authors.append({
        'author_id': a['author_id'],
        'name': a['name'],
        'email': a['email'],
        'phone': a['phone'],
        'city': a['city'],
        'joined_date': a['joined_date'],
        'total_books': len(a['books']),
        'total_earned': sum(b['total_royalty_earned'] for b in a['books']),
        'total_paid': sum(b['royalty_paid'] for b in a['books']),
        'total_pending': pending,
        'payout_status': AUTHOR_STATUS[worst],
    })


def write(name, rows):
    with open(f'data/{name}', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f'data/{name}: {len(rows)} rows')


write('authors.csv', authors)
write('books.csv', books)
write('payouts.csv', payouts)
print('statuses computed as of', AS_OF)
for a in authors:
    print(f"  {a['author_id']} {a['name']:<18} {a['city']:<11} pending {a['total_pending']:>6}  {a['payout_status']}")
for b in books:
    print(f"    {b['book_id']} {b['royalty_status']:<13} pending {b['royalty_pending']:>5}  last {b['last_payout_date'] or '-':<10}  published {b['publication_date'] or '-'}")
