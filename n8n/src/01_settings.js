// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS — the only node you should need to edit.
// Secrets are NOT here: the webhook key and the AI key live in n8n Credentials.
// ─────────────────────────────────────────────────────────────────────────────
const SETTINGS = {
  // AI provider (any OpenAI-compatible Chat Completions API).
  ai_base_url: 'https://api.groq.com/openai/v1', // OpenAI: https://api.openai.com/v1
  ai_model: 'openai/gpt-oss-120b',               // OpenAI: gpt-4o-mini
  ai_max_tokens: 3000,

  // Knowledge Base rules (Assignment 1) used to compute facts the AI must quote, never invent.
  payout_threshold_inr: 1000, // minimum payout, applied to the author's whole account
  overdue_after_days: 90,     // brief: red badge rule

  // Idempotency: the same author (or the same request) within this window is answered "Duplicate".
  dedupe_window_seconds: 120,

  // Bonus: actually send the email over SMTP (configure the SMTP credential on "Send email (SMTP)").
  // Dataset emails are fake (@email.com), so every email goes to test_recipient instead of the author.
  send_email: false,
  test_recipient: 'you@example.com',

  // Optional second channel: PATCH the Notification Log through Bubble's Data API.
  // Off by default because Bubble's FREE plan does not include the Data API; the synchronous
  // webhook response below is the primary channel and works on every plan.
  bubble_callback: false,
  bubble_api_base: 'https://YOUR-APP.bubbleapps.io/version-test/api/1.1/obj',
};

const req = $input.first().json;
return [{ json: { settings: SETTINGS, request: req.body ?? {}, received_at: new Date().toISOString() } }];
