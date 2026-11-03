# BookLeaf — Author Royalty Dashboard & Automated Notification System

Assignment 2 of 2. A **Bubble.io** app where authors see their royalties and admins trigger **AI-written royalty summary emails** through an **n8n** workflow.

| | |
|---|---|
| **Bubble app (test version, Free plan)** | https://santosh24x.bubbleapps.io/version-test |
| **Bubble editor** | https://bubble.io/page?id=santosh24x |
| **n8n workflow export** | [`n8n/bookleaf-royalty-summary.json`](n8n/bookleaf-royalty-summary.json) |
| **Screen recording (4 min)** | `<VIDEO_URL>` |
| **Author login** | `ananya.reddy@email.com` / `Author@123` (any other dataset author can create an account with their dataset email via *Create my author account*) |
| **Admin login** | `admin@bookleaf.example` / `Admin@123` |

---

## 1. How it fits together

```
 Bubble (Free plan)                                     n8n
 ───────────────────                                    ───────────────────────────────────────────
 Admin clicks "Generate & Send"                         Webhook  (header auth: X-BookLeaf-Key)
   1. create NotificationLog (Pending)                    → Settings → Validate payload ─┐ invalid → 400 Failed
   2. API Connector POST ── author + books JSON ────────►  → De-duplicate ───────────────┤ repeat  → Duplicate
                                                          → Compute royalty facts (code: totals, payout date, overdue)
                                                          → Build AI prompt → Call AI ───┤ error   → Failed (after 2 tries)
                                                          → Fact-check AI email ─────────┤ invented figure → Failed
                                                          → (bonus) Send email via SMTP
   3. response ◄──────── {status, subject, body, …} ──── → Respond: Success / Failed / Duplicate
   4. update the log row: Success / Failed / Duplicate    → (optional) PATCH Bubble Data API on paid plans
```

**Why the data travels in the webhook, and the result comes back in the response.** Bubble's Free plan has no *Bubble app API* (no Data API, no Workflow API) — checked on bubble.io/pricing. So n8n cannot read Bubble's database or call back into it. Instead Bubble sends the author's complete data in the webhook body (step 2 of the brief allows either) and n8n answers the same HTTP call with the outcome (step 5's "callback" is the response). This also has real advantages: one round trip instead of three, no Bubble admin token stored in n8n, and n8n never sees any author except the one it was asked about. If the app moves to a paid plan, the workflow already contains an optional **Update Bubble Notification Log (Data API)** branch — set `bubble_callback: true` in *Settings* and add the token credential.

## 2. Bubble database

See [`docs/BUBBLE_BUILD_GUIDE.md`](docs/BUBBLE_BUILD_GUIDE.md) for the full field list and the click-by-click build.

| Type | Key fields | Notes |
|---|---|---|
| **User** (built in) | `role` (Role), `author` (Author) | role is set by the sign-up workflow (Author) or by an admin in the editor (Admin) — never by the user |
| **Author** | author_id, name, email, phone, city, joined_date, `total_*`, `payout_status` | 1 → many Books |
| **Book** | book_id, title, `author` (Author), isbn, genre, status, `is_published`, publication_date, mrp, royalty figures, last_payout_date, print_partner, `platforms` (list of texts), `royalty_status` | `author_email` copied in for one-hop privacy rules |
| **Payout** | `book`, `author`, payout_date, amount_paid_to_date | payout history; the dataset only has the latest payout per book, so each book has ≤ 1 row today |
| **NotificationLog** | `author`, `triggered_by`, `status`, mode, email_subject, email_body, warnings, error_message, requested_at, completed_at | one row per request, created *before* calling n8n |
| **AppSettings** | `as_of_date` | single row (see "As-of date") |

Option sets: `Role`, `RoyaltyStatus`, `PayoutStatus`, `NotificationStatus` (each status option carries its badge colour).

**Choices worth explaining.** Relationships are real links (Book → Author), not text ids, so searches and privacy rules use them directly. Author totals and `payout_status` are stored (denormalised) so the admin list can filter and sort without summing books per row; the author dashboard cards are computed from the books so they can never drift. The red/yellow/green badge is computed live with conditionals against the as-of date.

**Royalty status rules** (same in Bubble, the CSV generator and n8n): green = nothing pending; yellow = pending within the normal cycle; red = pending and the last payout was more than 90 days ago, or a published book has never been paid and is older than 90 days. One deliberate refinement from the Knowledge Base: if the author's whole account has less than ₹1,000 pending, it is **yellow ("below minimum")**, not red — the balance rolls over by policy, so it is not overdue (Kavita's ₹850).

**As-of date.** The dataset is a snapshot (latest payout 1 Dec 2025). Against today's real date every pending book would be red, so all date rules use `AppSettings.as_of_date` (15 Dec 2025), which the admin can change to today in one click. The same date is sent to n8n so the email matches the dashboard.

## 3. Privacy

Every type starts with nothing visible to "everyone else". Authors match on email (`This Author's email is Current User's email`, `This Book's author_email is Current User's email`); admins match on `Current User's role is Admin`; NotificationLog is admin-only. Page redirects are a convenience; privacy rules are the protection (searches simply return nothing for other authors' rows).

## 4. n8n workflow

21 nodes, export in `n8n/`. The JavaScript of every Code node is also kept as readable files in [`n8n/src/`](n8n/src) and assembled by `tools/build_workflow.py`.

| Node | Job |
|---|---|
| Webhook from Bubble | POST `/webhook/bookleaf/royalty-summary`, **Header Auth credential** `X-BookLeaf-Key`; wrong/missing key → 403 before any node runs |
| Settings (edit me) | model, base URL, thresholds, dedupe window, SMTP/callback switches — no secrets |
| Validate payload | required fields, numbers, dates; invalid → **400 Failed** with the field errors |
| De-duplicate | workflow static data: same `request_id`, or the same author within 120 s → **Duplicate** (no AI call). A failed attempt releases the author lock so a retry works immediately |
| Compute royalty facts | totals recomputed from books (not trusted from the caller), next payout date (quarter end + 45 days), ₹1,000 account minimum, 90-day overdue rule, production stage and remaining stages |
| Build AI prompt | static policy + tone + rules, then the FACTS block; JSON output requested |
| Call AI | OpenAI-compatible HTTP call (Groq `openai/gpt-oss-120b`; OpenAI/Anthropic-compatible by changing Settings), 25 s timeout, 2 tries, **error output → failure path** |
| Fact-check AI email | parses JSON; every ₹ amount and date in the email must exist in FACTS, otherwise **Failed** ("nothing was sent"); softer issues (missing book, no finance escalation for overdue, production mentioned when none) become warnings |
| Send email (SMTP) | bonus, off by default; sends to `test_recipient` (dataset emails are fake) |
| Build success / failure response → Respond | Bubble always gets an answer: Success, Failed (with stage + reason) or Duplicate |
| Update Bubble Notification Log | optional Data API PATCH for paid plans |

## 5. Prompt strategy

1. **Code decides the facts, the model writes the words.** Totals, payout dates and statuses are computed in the *Compute royalty facts* node and passed as labelled lines (`PUBLISHED_BOOK`, `TOTALS`, `NEXT_PAYOUT_DATE`, `BELOW_MINIMUM`, `REQUIRED_ACTION`, `IN_PRODUCTION`). The model never does date maths.
2. **Scenario-specific instructions are data, not prompt branches.** One prompt covers every author; the facts carry the scenario. An overdue book gets a `REQUIRED_ACTION` line (own it — "this is on us", escalated to finance, update within 48 hours, never "wait for the next payout"); a sub-₹1,000 balance gets `BELOW_MINIMUM`; a fully-paid author gets a positive acknowledgement; books in production get a stage update with what comes next.
3. **Knowledge Base and tone from Assignment 1** are in the system prompt: quarterly cycle, 45-day window, ₹1,000 minimum, 48-hour escalation, the nine production stages, "authors are partners", specific numbers, firm timelines, one clear next step.
4. **Verify, don't trust.** JSON output, then a deterministic fact-check of every amount and date. Lessons carried over from Assignment 1: the model is never given a future payout date for an overdue book (it would promise a second delay), typographic spaces are normalised, and the signature is added by code.

Measured on the real model (Groq `gpt-oss-120b`, all 10 dataset authors, 3 Nov 2026): **10/10 passed the fact check with zero warnings**, median ≈ 1.2 s per email, ≈ 1,000 input + 270 output tokens (≈ $0.0003 per email at list price). Five of them, unedited, are in [`docs/SAMPLE_EMAILS.md`](docs/SAMPLE_EMAILS.md). A first run exposed two prompt issues that I then fixed: an author with nothing in production got a needless "no books in production" line (the facts no longer carry an empty `IN_PRODUCTION` line, and the checker warns if production is mentioned), and "transferred **on** 14 February" over-promised a policy that says "within 45 days" (the prompt now asks for "by").

## 6. Error handling

| Failure | What happens | What the admin sees |
|---|---|---|
| Wrong / missing webhook key | n8n rejects with 403 | log row **Failed** ("HTTP 403") |
| Bad payload | 400 with field errors | **Failed** + reason |
| Same author clicked twice | button disabled while Pending; n8n also answers **Duplicate** | **Duplicate** row, no second email |
| AI API down / 429 / timeout | 2 tries, then failure branch | **Failed** "AI service call failed (HTTP 500) …" |
| AI invents a number or date | fact-check rejects it | **Failed** "amounts not in the author's data: ₹5,000 …" |
| n8n unreachable / workflow inactive | API Connector returns an error (errors are captured, workflow continues) | **Failed** with the connector's error |
| Request lost in transit | — | a Pending row older than 2 minutes is shown as **Timed out** |

## 7. Testing

- `tools/test_workflow.mjs` runs **42 checks against a real n8n 2.45 (all passing)** with `tools/ai_stub.mjs` standing in for the AI: all 10 dataset authors (overdue, pending, below-minimum, fully paid, in production), duplicate request / duplicate author, retry after failure, missing and wrong key, invalid payload, AI 500, AI inventing ₹5,000, AI returning non-JSON. An accidental run with the stub stopped also showed the "AI unreachable" path end to end: every request came back `Failed` with `connect ECONNREFUSED` instead of hanging.
- The real model was run on all 10 authors through the same prompt and fact-check (numbers above).
- **Live, end to end (3 Nov 2026, Bubble test version → n8n Cloud → Groq):**
  - Single *Generate & Send* (Ananya, overdue): the log row appears as **Pending** at once and turns **Success** a few seconds later with the AI email ("…this is on us. We have escalated this to our finance team… update within 48 hours").
  - Bulk send to the 9 authors with pending royalties: every author got a **Success** row with their own email, sent one after another.
  - Idempotency: clicking again for an author within 120 s gives a **Duplicate** row ("Not sent again…") and no AI call.
  - Failure path: the first ever call ran with a wrong AI key; n8n answered `Failed` / stage `ai_api` / "AI service call failed (HTTP 401)…" and nothing hung.
  - Data isolation: logged in as Ananya, the dashboard shows only her book and totals; the admin pages redirect authors back to their dashboard.

## 8. Running the n8n side yourself

1. n8n Cloud (or self-hosted + a public tunnel) → **Import from file** → `n8n/bookleaf-royalty-summary.json`.
2. Create three credentials (Credentials → New → **Header Auth**):
   - *BookLeaf webhook key (X-BookLeaf-Key)*: name `X-BookLeaf-Key`, value = a long random secret (same value goes into Bubble's API Connector as a **private** header).
   - *AI API key (Authorization: Bearer)*: name `Authorization`, value `Bearer <your Groq/OpenAI key>`.
   - (optional) SMTP account for the bonus email node.
3. Open **Webhook from Bubble** and **Call AI** and pick the matching credential in each (imported workflows keep the credential *names* but never the secrets). Change *Settings (edit me)* only for another model/provider.
4. **Publish** the workflow (n8n 2.x: *Publish*; the two optional nodes, SMTP and the Bubble Data-API callback, ship disabled because n8n will not publish nodes without credentials) and copy the **production** webhook URL (`…/webhook/bookleaf/royalty-summary`, not the `webhook-test` one) into Bubble's API Connector.
5. Quick test without Bubble: `node tools/payload.mjs AUTH003 > p.json` then `curl -X POST <url> -H "X-BookLeaf-Key: <secret>" -H "Content-Type: application/json" -d @p.json`.

## 9. Learning log

This was my first Bubble app. What I learned along the way, including what did not work the first time:

- **Bubble Free plan limits shape the design.** No Data API / Workflow API (so n8n cannot call back into Bubble; the result travels in the HTTP response), no CSV upload (data entered via App data → New entry), no live deployment (the app runs on the `version-test` URL), and only frontend scheduled custom events (so bulk send is a self-scheduling custom event that runs while the admin keeps the page open).
- **Links are references, not ids.** My first data entry stored Book → Author links as bare unique ids. Every search on the link (`author = Current page's Author`) silently returned nothing, and a "below ₹1,000 minimum" badge appeared for an overdue book because "author's total pending" was empty, and empty < 1000. Re-linking the records fixed both. Lesson: when a list is unexpectedly empty, check the link fields in App data before suspecting privacy rules.
- **Privacy rules first, pages second.** Each type starts with nothing visible; authors match on email, admins on role. That made the author dashboard safe by default, and it is why the admin pages also have a page-load redirect only as a convenience.
- **API Connector initialisation fixes the response shape.** Bubble learns field types from one sample response, so success and failure answers from n8n were made to share the same keys (`stage`/`error_message` on success, `subject`/`body`/`warnings_text` on failure). An empty list (`warnings: []`) is not typed by Bubble, so n8n also returns `warnings_text`.
- **JSON-safe formatting.** The request body is built in Bubble with `:formatted as JSON-safe` for texts and dates; numbers do not have that operator and are inserted as plain numbers. Dates arrive as Indian midnight in UTC (`2025-10-14T18:30:00Z`), which the n8n facts node rounds back to the calendar date.
- **"Create a new thing" vs "Make changes".** In my first version the new Notification Log row kept its status updates but lost its initial author/mode, so it did not show on the author's page; the create step's initial values were not being saved. Testing the author page, not just the n8n side, caught it.
- **n8n Cloud publishing.** n8n 2.x keeps edits as a draft until *Publish*, and it refuses to publish while any node lacks credentials, so the optional SMTP and Data-API nodes ship disabled.
- **How I worked.** I used an AI coding assistant (Claude) as a pair-builder, the same way I would use one in a team. I set the design decisions: the schema, the privacy model, payload-in-webhook instead of the Data API, code-computed facts plus a fact-check around the AI, and the as-of date. I then tested every flow in the live app myself. The assistant did much of the repetitive editor work (data entry, page layout, wiring workflows) through Bubble's editor, so the result is an ordinary Bubble app: every page, workflow and privacy rule can be opened and edited in the editor. The n8n workflow is generated from the readable JavaScript in `n8n/src/` and covered by the tests in `tools/`. The bugs in this log were found by testing, not by reading code.

## 10. Repository layout

```
data/        bookleaf_sample_data.json + CSVs of the same data (authors, books, payouts; on the Free plan they were entered via App data)
docs/        BUBBLE_BUILD_GUIDE.md (schema, privacy rules, pages, workflows, test checklist), SAMPLE_EMAILS.md
n8n/         bookleaf-royalty-summary.json (the export) and src/ (each Code node as a .js file)
tools/       make_csv.py, build_workflow.py, payload.mjs, ai_stub.mjs, test_workflow.mjs
```
