/**
 * Email sender with a zero-dependency dev fallback.
 *
 * - If RESEND_API_KEY is set, sends via the Resend REST API (using global fetch).
 * - Otherwise (dev mode), logs the message + link to the server console so the
 *   password-reset / verification flows are fully testable without a provider.
 */

interface MailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export function mailerConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendMail({ to, subject, html, text }: MailArgs): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || "Plume <onboarding@resend.dev>";

  if (!key) {
    const plain = text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(
      `\n──────── [mailer:dev] email NOT sent (no RESEND_API_KEY) ────────\n` +
        `  To:      ${to}\n  Subject: ${subject}\n  Body:    ${plain}\n` +
        `────────────────────────────────────────────────────────────────\n`
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Mail send failed:", res.status, body);
    throw new Error("Failed to send email");
  }
}

/** Simple branded HTML wrapper for a call-to-action email. */
export function actionEmail(opts: {
  heading: string;
  body: string;
  buttonLabel: string;
  url: string;
}): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1d2033">
    <h2 style="margin:0 0 8px">${opts.heading}</h2>
    <p style="color:#555;line-height:1.5">${opts.body}</p>
    <p style="margin:24px 0">
      <a href="${opts.url}" style="background:#4e57d4;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${opts.buttonLabel}</a>
    </p>
    <p style="color:#888;font-size:13px">Or paste this link into your browser:<br><span style="color:#4e57d4">${opts.url}</span></p>
    <p style="color:#aaa;font-size:12px;margin-top:24px">Plume · If you didn't request this, you can ignore this email.</p>
  </div>`;
}
