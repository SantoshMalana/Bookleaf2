# Bubble build guide (step by step)

This is the exact build order for the Bubble side. Follow it top to bottom; each part ends with a check so you know it works before moving on. Names in `code` are the names to type in Bubble, so the n8n workflow, the README and the video all match.

> Free plan note: Bubble's Free plan does **not** include the "Bubble app API" (Data API / Workflow API). That is why n8n receives the author's data **in the webhook body** and returns the result **in the HTTP response**, instead of reading and writing Bubble directly. Everything below works on the Free plan.

---

## Part 0 — Create the app (10 min)

1. bubble.io → sign up → **Create an app** → name it `bookleaf-royalty` → choose **Start from scratch / blank** (skip the AI app generator; we want to build the structure ourselves).
2. Settings → General: app name "BookLeaf Royalty Portal". Settings → Languages: leave English.
3. Plugins → **Add plugins** → install **API Connector** (by Bubble).

---

## Part 1 — Option sets (10 min)

Data tab → **Option sets**. Create these; the display text must match exactly, because the CSV import matches on it.

| Option set | Options (display) | Extra attributes |
|---|---|---|
| `Role` | `Author`, `Admin` | — |
| `RoyaltyStatus` | `Paid up`, `Pending`, `Overdue`, `In production` | `color` (text): `#16A34A`, `#D97706`, `#DC2626`, `#6B7280` |
| `PayoutStatus` | `Fully paid`, `Pending`, `Overdue`, `No royalties yet` | `color` (text): same four colours in that order |
| `NotificationStatus` | `Pending`, `Success`, `Failed`, `Duplicate` | `color` (text): `#6B7280`, `#16A34A`, `#DC2626`, `#2563EB` |

Why option sets: statuses are a fixed vocabulary, so option sets give typo-proof values, free colours for badges, and they cost nothing in database reads.

---

## Part 2 — Data types (30 min)

Data tab → **Data types**. Create the types and fields exactly as below.

**User** (built in) — add fields:
- `role` → Role
- `author` → Author

**Author**
- `author_id` text · `name` text · `email` text · `phone` text · `city` text · `joined_date` date
- `total_books` number · `total_earned` number · `total_paid` number · `total_pending` number
- `payout_status` → PayoutStatus

**Book**
- `book_id` text · `title` text · `author` → Author · `author_code` text · `author_email` text
- `isbn` text · `genre` text · `status` text · `is_published` yes/no
- `publication_date` date · `mrp` number · `royalty_per_copy` number
- `copies_sold` number · `royalty_earned` number · `royalty_paid` number · `royalty_pending` number
- `last_payout_date` date · `print_partner` text · `platforms` **list of texts** · `royalty_status` → RoyaltyStatus

**Payout**
- `payout_id` text · `book` → Book · `author` → Author · `author_email` text · `payout_date` date · `amount_paid_to_date` number · `note` text

**NotificationLog**
- `author` → Author · `triggered_by` → User · `status` → NotificationStatus · `mode` text (`single` / `bulk`)
- `email_subject` text · `email_body` text · `error_message` text · `warnings` text
- `requested_at` date · `completed_at` date · `model` text

**AppSettings** (exactly one row)
- `as_of_date` date

Why this shape: Author 1→N Book, Book 1→N Payout (the dataset only has the latest payout per book, so each book has at most one Payout row today, but the type is ready for real history). `author_email` is copied onto Book and Payout on purpose: the privacy rules can then compare one field with the current user's email instead of walking a relationship. The `total_*` fields on Author are denormalised so the admin list can filter and sort without summing books on every row.

**Check:** Data → Data types shows 6 custom types plus User.

---

## Part 3 — Import the dataset (30 min)

> **Free plan note (what actually happened in this build).** Bubble's CSV upload is a paid feature ("Upgrade to a paid plan to gain the ability to upload CSV files"), so the live app's data was entered through **App data → New entry** instead: 10 Authors, 18 Books, 12 Payouts, 1 AppSettings row, with the same values as the CSVs. If you do this by hand, set the link fields (Book → author, Payout → book/author) by picking the record in the dropdown. A link stored as a bare unique id does not resolve; Bubble stores links as references, and a search on `author = Current page's Author` silently returns nothing if the links are broken. The CSV steps below are for a paid plan.

The files are in `data/`: `authors.csv`, `books.csv`, `payouts.csv`. Order matters (books link to authors).

1. Data → **App data** → choose type **Author** → **Upload** → pick `authors.csv` → map each column to the field with the same name (`payout_status` → PayoutStatus). Dates are `YYYY-MM-DD`. Upload. **Check:** 10 Authors.
2. Type **Book** → Upload `books.csv`. Map columns to fields. For the `author` column (type Author), choose to match on **author_id** if the uploader offers a matching field. `platforms` → list of texts (comma separated), `royalty_status` → RoyaltyStatus, `is_published` → yes/no. **Check:** 18 Books.
   - If the uploader only accepts unique IDs for the `author` link, skip that column now; `author_code` still imports, and Part 3b links them.
3. Type **Payout** → Upload `payouts.csv` (map `book` by book_id and `author` by author_id the same way; skip if not offered and use 3b). **Check:** 12 Payouts.
4. Type **AppSettings** → **New entry** → `as_of_date` = **12/15/2025**. (See "As-of date" below.)

**3b — Link fallback (only if the uploader would not link by author_id).** Make a temporary page `setup` with one button "Link records" and a custom state `i` (number, default 1) on the page:
- Button click → Set state `i` = 1 → Trigger custom event `link-next`.
- Custom event `link-next`, Only when `i ≤ Search for Books:count`:
  1. Make changes to `Search for Books:sorted by book_id:item # i` → `author` = `Search for Authors (author_id = that Book's author_code):first item`
  2. Set state `i` = `i + 1`
  3. Schedule custom event `link-next` (delay 0.2 s)

Run it once, check every Book has an author, then delete the page. (Same pattern for Payouts.)

**As-of date.** The dataset is a snapshot: its latest payout is 1 Dec 2025. Measured against today's real date every pending book would be "overdue", which hides the green/yellow/red logic, so all date rules use `AppSettings' as_of_date` (15 Dec 2025 by default). The admin can change it to today in one click (Part 7). The CSV statuses were computed with the same date.

---

## Part 4 — Sign-up, log-in and roles (45 min)

Pages: `index` (log in), `signup`, `dashboard` (author), `admin`, `admin_author` (page type **Author**), `no_access`.

**index (log in):** Input `email`, Input `password` (content format: password), Button "Log in", Text link "Create your account" → signup.
- Workflow: Button Log in clicked → **Log the user in** (email, password) → Go to page `admin` *Only when Current User's role is Admin* → Go to page `dashboard` *Only when Current User's role is Author* → Go to page `no_access` *Only when Current User's role is empty*.
- Show the error: Bubble shows a login error alert by default; add an "An unhandled error occurs" event that shows a red text "Wrong email or password".

**signup:** Inputs email, password, confirm password. Button "Create account".
- Workflow:
  1. **Sign the user up** (email, password, password confirmation).
  2. Make changes to Current User → `role` = Author, `author` = `Search for Authors (email = Current User's email):first item` — *Only when* `Search for Authors (email = Current User's email):count > 0`.
  3. Go to page `dashboard` *Only when Current User's author is not empty*; otherwise Go to page `no_access`.
- Step 2 works because of the privacy rule "Author can see own record" (Part 5): once signed up, a user can find the Author row that has the same email, and nothing else.

**Admin account:** sign up once with `admin@bookleaf.example` (it lands on `no_access` because no Author has that email). Then Data → App data → User → edit that user → `role` = **Admin**. Roles are only ever set by the sign-up workflow (Author) or by you in the editor (Admin); no page lets a user change their own role.

**Test accounts to create (for the reviewers):** sign up as `ananya.reddy@email.com` (overdue), `kavita.deshmukh@email.com` (below minimum + book in production), `farhan.sheikh@email.com` (fully paid), `priya.sharma@email.com` (pending), all with password `Author@123`; admin password `Admin@123`.

**Page guards:** on `dashboard` page load → Go to `index` when Current User is logged out; Go to `admin` when role is Admin. On `admin` and `admin_author` page load → Go to `index` when logged out; Go to `dashboard` when role is not Admin. (Guards are convenience; the real protection is Part 5.)

---

## Part 5 — Privacy rules (30 min) — the part they will test

Data → **Privacy**. For every type, **uncheck everything for "Everyone else"** first, then add:

| Type | Rule name | When | Allow |
|---|---|---|---|
| Author | `Author can see own record` | `This Author's email is Current User's email` | View all fields, Find in searches |
| Author | `Admin sees all` | `Current User's role is Admin` | View all fields, Find in searches, (attachments n/a) |
| Book | `Author sees own books` | `This Book's author_email is Current User's email` | View all fields, Find in searches |
| Book | `Admin sees all` | `Current User's role is Admin` | all |
| Payout | `Author sees own payouts` | `This Payout's author_email is Current User's email` | View all fields, Find in searches |
| Payout | `Admin sees all` | `Current User's role is Admin` | all |
| NotificationLog | `Admin only` | `Current User's role is Admin` | all (authors get nothing) |
| AppSettings | `Logged-in users can read` | `Current User is logged in` | View all fields, Find in searches |
| User | `User sees self` | `This User is Current User` | View all fields |
| User | `Admin sees all users` | `Current User's role is Admin` | View all fields, Find in searches |

Also: Settings → General → leave "Allow auto-binding" off for role fields (we never auto-bind `role`).

**Check (do this, they will):** log in as Ananya → Data in the browser console or any search on the page can only ever return her 1 book. Log in as Priya → only her 2 books. Log out → no data at all. In the editor's "Run as" (App data → User → Run as) you can switch users quickly.

---

## Part 6 — Author portal (`dashboard`) (1.5 h)

Build one **reusable element** `BookRoyaltyList` (type of content: Author) so the same table is used by authors and admins.

**Reusable `BookRoyaltyList`**
- Repeating group `RG Books`, type Book, data source `Search for Books (author = Parent's Author)` sorted by `publication_date` descending (empty last), layout: rows.
- Each row shows: title (bold), `isbn`, `genre`, `status`, `publication_date:formatted as 15 Dec 2025` (show "—" when empty), `mrp` (`₹` + `:formatted as 1,000`), `platforms:join with ", "`, `copies_sold`, `royalty_earned`, `royalty_paid`, `royalty_pending`, `last_payout_date` (or "Never paid" / "—").
- **Badge** (a Group with a Text inside) — computed live with conditionals, using `S` = `Search for AppSettings:first item's as_of_date`. Conditions are evaluated top to bottom, the last true one wins, so put them in this order:
  1. Default: text "In production", background `#6B7280`.
  2. When `Current cell's Book's is_published is yes` → "Paid up", `#16A34A`.
  3. When `is_published is yes and royalty_pending > 0` → "Pending", `#D97706`.
  4. When `is_published is yes and royalty_pending > 0 and last_payout_date < S +(days) -90` → "Overdue", `#DC2626`.
  5. When `is_published is yes and royalty_pending > 0 and last_payout_date is empty and publication_date < S +(days) -90` → "Overdue", `#DC2626`.
  6. When `royalty_pending > 0 and Current cell's Book's author's total_pending < 1000` → "Pending · below ₹1,000 minimum", `#D97706` (Knowledge Base: balances under ₹1,000 roll over, so they are not overdue).
- Add a small legend under the list: green = fully paid · yellow = pending within the normal cycle · red = overdue (pending and no payout in 90+ days).

**dashboard page**
- Header: "Welcome, `Current User's author's name`" and a Log out button (Log the user out → go to index).
- Four summary cards, each summing the author's books (computed, not stored, so they can never drift):
  - Total earned = `Search for Books (author = Current User's author):each item's royalty_earned:sum`
  - Total paid, Total pending — same with `royalty_paid`, `royalty_pending`
  - Books = `…:count` with "N published · M in production"
- `BookRoyaltyList` with data source `Current User's author`.
- Note text: "Royalties are calculated quarterly and paid within 45 days of the quarter ending. Minimum payout ₹1,000."

**Check:** Ananya sees 1 book, red; Kavita sees 1 yellow ("below ₹1,000 minimum") and 1 grey; Farhan sees green; Priya sees 1 yellow + 1 green.

---

## Part 7 — Admin portal (`admin`, `admin_author`) (2 h)

**admin page**
- Filters row: Input `Search name`, Dropdown `City` (choices: `Search for Authors:each item's city:unique` sorted), Dropdown `Payout status` (choices: All PayoutStatus), Button "Clear".
- Repeating group `RG Authors`, type Author: `Search for Authors (name contains Search name's value, city = City's value, payout_status = Payout status's value)` with **Ignore empty constraints** ticked, sorted by name. Columns: name, city, total_books, total_earned, total_pending, payout_status badge (background = `payout_status's color`), button **View** → Go to page `admin_author` with data `Current cell's Author`.
- Button **"Send summaries to all authors with pending royalties"** (bulk, Part 9).
- **Notification log** repeating group, type NotificationLog: `Search for NotificationLogs` sorted by `requested_at` descending. Columns: author's name, `mode`, status badge (`status's color`), requested_at, completed_at, `email_subject`; row click → popup showing `email_body`, `warnings`, `error_message`.
  - Conditional on the status text: when `status is Pending` and `requested_at < Current date/time +(minutes) -2` → show "Timed out" in red. (No eternal spinner even if a request was lost.)
- Small settings area: "Data as of `AppSettings' as_of_date`" + date picker + button "Save as-of date" (Make changes to AppSettings first item) + button "Use today".

**admin_author page** (type of content Author)
- Header: author name, email, city, joined date, payout_status badge.
- `BookRoyaltyList` (data source Current page's Author).
- Totals cards (same sums as dashboard, for Current page's Author).
- Payout history repeating group: `Search for Payouts (author = Current page's Author)` → book title, payout_date, amount_paid_to_date, note.
- Button **"Generate & Send Royalty Summary"** (Part 8) + a log list filtered to this author.

---

## Part 8 — Connect n8n (1.5 h)

**API Connector** (Plugins → API Connector → Add another API)
- API name `BookLeaf n8n`. Authentication: None or self-handled.
- Shared header: key `X-BookLeaf-Key`, value = the same secret you put in the n8n credential, **tick Private** (never sent to the browser).
- Add call `Send royalty summary`:
  - Use as **Action**, Data type **JSON**, method **POST**
  - URL: the n8n **production** webhook URL, e.g. `https://YOUR.app.n8n.cloud/webhook/bookleaf/royalty-summary`
  - Header `Content-Type: application/json`
  - Body (type exactly; `<…>` are dynamic parameters — untick "Private" on each so workflows can fill them):

```json
{
  "request_id": "<request_id>",
  "as_of_date": "<as_of_date>",
  "author": {
    "author_id": <author_id>,
    "name": <name>,
    "email": <email>,
    "city": <city>
  },
  "books": [<books>]
}
```

  - `author_id`, `name`, `email`, `city` have **no quotes** around them in the template because you will fill them with `:formatted as JSON-safe`, which adds the quotes and escapes characters like `"` or `&`.
  - Tick **"Include errors in response and allow workflow actions to continue"** — this is what lets the workflow mark the log "Failed" instead of stopping with an error popup.
  - **Initialize call** with sample values (n8n workflow must be active). For `books` paste one book JSON object, e.g. `{"title":"Test","status":"Published & Live","copies_sold":"1","royalty_earned":"10","royalty_paid":"0","royalty_pending":"10","publication_date":"2025-01-01","last_payout_date":""}`. Bubble then learns the response fields: `status`, `subject`, `body`, `warnings`, `error_message`, `model`, `completed_at`.

**The `books` value (in workflows):** `Search for Books (author = <the author>):format as text`
- Content per item (one line):
  `{"book_id": This Book's book_id:formatted as JSON-safe, "title": This Book's title:formatted as JSON-safe, "status": This Book's status:formatted as JSON-safe, "isbn": This Book's isbn:formatted as JSON-safe, "publication_date": "This Book's publication_date:formatted as yyyy-mm-dd", "copies_sold": "This Book's copies_sold", "royalty_per_copy": "This Book's royalty_per_copy", "royalty_earned": "This Book's royalty_earned", "royalty_paid": "This Book's royalty_paid", "royalty_pending": "This Book's royalty_pending", "last_payout_date": "This Book's last_payout_date:formatted as yyyy-mm-dd", "platforms": This Book's platforms:join with ", ":formatted as JSON-safe}`
- Delimiter: `,`
- Numbers are sent in quotes on purpose: an empty number would otherwise produce invalid JSON; n8n converts them back.
- For the date format pick **Custom** and type the year-month-day pattern; n8n also accepts Bubble's default date text if that is easier.

**Workflow: button "Generate & Send Royalty Summary"** (admin_author page). Page custom state `sending` (yes/no).
- Button conditional: when `sending is yes` **or** `Search for NotificationLogs (author = Current page's Author, status = Pending, requested_at > Current date/time +(minutes) -2):count > 0` → *not clickable*, text "Sending…".
- When clicked (Only when `sending is no`):
  1. Set state `sending` = yes
  2. **Create a new NotificationLog**: author = Current page's Author, triggered_by = Current User, status = Pending, mode = `single`, requested_at = Current date/time
  3. **BookLeaf n8n – Send royalty summary**: request_id = Result of step 2's unique id; as_of_date = `Search for AppSettings:first item's as_of_date:formatted as yyyy-mm-dd`; author_id / name / email / city = Current page's Author's … `:formatted as JSON-safe`; books = the expression above.
  4. Make changes to Result of step 2 → status = Success, email_subject = Result of step 3's subject, email_body = Result of step 3's body, warnings = Result of step 3's warnings:join with "\n", model = Result of step 3's model, completed_at = Current date/time — *Only when Result of step 3's status is "Success"*
  5. Make changes to Result of step 2 → status = Duplicate, error_message = Result of step 3's error_message, completed_at = now — *Only when status is "Duplicate"*
  6. Make changes to Result of step 2 → status = Failed, error_message = Result of step 3's error_message (or, if the call itself errored, `Result of step 3's error body`), completed_at = now — *Only when status is "Failed" or Result of step 3 returned an error*
  7. Set state `sending` = no, and show a short alert ("Summary generated" / "Failed — see the log").

Why the response, not a callback: on the Free plan n8n cannot call into Bubble (no Data/Workflow API), so the HTTP response *is* the callback. n8n always answers (Success / Failed / Duplicate) and never leaves the call hanging; if n8n is unreachable or times out, the API Connector returns an error and step 6 marks the log Failed.

---

## Part 9 — Bulk send (1 h)

Page states on `admin`: `queue` (list of Authors), `i` (number), `bulk_running` (yes/no).

- Button "Send summaries to all authors with pending royalties" (not clickable while `bulk_running`):
  1. Set state `queue` = `Search for Authors (total_pending > 0):sorted by name`; `i` = 1; `bulk_running` = yes
  2. Trigger custom event `bulk-next`
- Custom event `bulk-next`:
  - Only when `i ≤ queue:count`: steps 2–6 of Part 8 for `queue:item # i` (mode = `bulk`), then Set state `i` = `i + 1`, then **Schedule custom event** `bulk-next` (delay 1 s).
  - Only when `i > queue:count`: Set `bulk_running` = no; alert "Sent summaries to N authors".
- Show progress text: "Sending i of queue:count…" while `bulk_running`.

Why sequential: one call per eligible author through the same webhook (as the brief asks), each with its own log row, and it naturally respects AI rate limits — a burst of parallel calls would hit the provider's per-minute limit and fail half the batch. Backend "Schedule API workflow on a list" would also work but is limited on the Free plan.

---

## Part 10 — Test checklist (before recording)

- [ ] Ananya: 1 book, red badge, totals ₹2,546 / ₹0 / ₹2,546.
- [ ] Kavita: yellow "below ₹1,000 minimum" + grey "In production".
- [ ] Farhan: green, ₹0 pending.
- [ ] Logged in as Ananya, the admin page redirects away and no other author's data loads.
- [ ] Admin list: filter City = Hyderabad → Ananya only; Payout status = Overdue → 5 authors (as of 15 Dec 2025).
- [ ] Generate for Ananya → log row Pending → Success within ~10 s, email mentions overdue + finance + 48 hours.
- [ ] Double-click Generate → second click does nothing (button disabled) and, if forced, n8n answers Duplicate.
- [ ] Deactivate the n8n workflow → Generate → log shows Failed with a reason (no spinner).
- [ ] Bulk → 9 rows (every author with pending royalty), one at a time.
