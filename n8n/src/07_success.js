// Shape the Success response that Bubble writes into the Notification Log.
const ctx = $('Validate payload').first().json;
const email = $('Fact-check AI email').first().json;
const sent = $input.first().json; // from "Send email (SMTP)" when enabled, otherwise the fact-check output

const emailSent = ctx.settings.send_email ? !sent.error : false;
const warnings = [...email.warnings];
if (ctx.settings.send_email && sent.error) warnings.push(`SMTP send failed: ${String(sent.error.message ?? sent.error).slice(0, 160)}. The email content is still logged.`);

return [{
  json: {
    response: {
      status: 'Success',
      request_id: ctx.request_id,
      author_id: ctx.author_id,
      subject: email.subject,
      body: email.body,
      warnings,
      email_sent: emailSent,
      sent_to: emailSent ? ctx.settings.test_recipient : null,
      model: email.model,
      completed_at: new Date().toISOString(),
    },
  },
}];
