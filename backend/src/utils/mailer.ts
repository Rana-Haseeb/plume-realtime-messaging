/**
 * Email sender via Gmail SMTP (nodemailer), with a zero-config dev fallback.
 *
 * - If GMAIL_USER + GMAIL_APP_PASSWORD are set, sends real emails through Gmail.
 * - Otherwise (dev mode / placeholders), logs the message + link to the server
 *   console so the password-reset / verification flows stay fully testable.
 *
 * To enable real sending, in `backend/.env` set:
 *   GMAIL_USER=your-address@gmail.com
 *   GMAIL_APP_PASSWORD=your-16-char-app-password   (Google Account → Security →
 *                                                   2-Step Verification → App passwords)
 *   MAIL_FROM=Plume <your-address@gmail.com>       (optional display name)
 */
import nodemailer, { Transporter } from "nodemailer";

interface MailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

export function mailerConfigured(): boolean {
  return !!(GMAIL_USER && GMAIL_APP_PASSWORD);
}

export async function sendMail({ to, subject, html, text }: MailArgs): Promise<void> {
  const tx = getTransporter();

  if (!tx) {
    const plain = text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(
      `\n──────── [mailer:dev] email NOT sent (no GMAIL credentials) ────────\n` +
        `  To:      ${to}\n  Subject: ${subject}\n  Body:    ${plain}\n` +
        `────────────────────────────────────────────────────────────────────\n`
    );
    return;
  }

  const from = process.env.MAIL_FROM || `Plume <${GMAIL_USER}>`;
  await tx.sendMail({ from, to, subject, html, text });
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
