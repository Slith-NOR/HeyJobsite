import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { outboundMessages } from "@/db/schema";
import { emailFrom, emailProvider, emailReplyTo, postmarkServerToken } from "./config";
import { DomainError } from "./errors";

export type EmailMessage = { to: string; subject: string; body: string };

const POSTMARK_URL = "https://api.postmarkapp.com/email";
const POSTMARK_TIMEOUT_MS = 10_000;

/**
 * Email channel behind a small adapter.
 * - "dev": writes the full message to the outbox for the local dev inbox (/dev/inbox); sends nothing.
 * - "postmark": sends through Postmark. The outbox keeps recipient, subject, status and Postmark's
 *   message ID but never the body, because login emails contain working sign-in links.
 */
export async function sendEmail(
  db: DB,
  msg: EmailMessage,
  deps: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {},
) {
  const env = deps.env ?? process.env;
  const provider = emailProvider(env);
  if (provider === "dev") {
    await db.insert(outboundMessages).values({ channel: "email", recipient: msg.to, subject: msg.subject, body: msg.body, provider: "dev", status: "dev_inbox" });
    return;
  }
  if (provider !== "postmark") throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);

  const [row] = await db
    .insert(outboundMessages)
    .values({ channel: "email", recipient: msg.to, subject: msg.subject, body: "", provider: "postmark", status: "sending", attempts: 1 })
    .returning({ id: outboundMessages.id });

  const doFetch = deps.fetch ?? fetch;
  let error: string;
  try {
    const res = await doFetch(POSTMARK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": postmarkServerToken(env) ?? "",
      },
      body: JSON.stringify({
        From: emailFrom(env),
        To: msg.to,
        ReplyTo: emailReplyTo(env),
        Subject: msg.subject,
        TextBody: msg.body,
        MessageStream: "outbound",
        // Tracking would rewrite the sign-in link and open it from Postmark's servers.
        TrackOpens: false,
        TrackLinks: "None",
      }),
      signal: AbortSignal.timeout(POSTMARK_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as { ErrorCode?: number; Message?: string; MessageID?: string };
    if (res.ok && data.ErrorCode === 0) {
      await db.update(outboundMessages).set({ status: "sent", providerMessageId: data.MessageID ?? null }).where(eq(outboundMessages.id, row.id));
      return;
    }
    error = `HTTP ${res.status}, Postmark error ${data.ErrorCode ?? "?"}: ${data.Message ?? "no message"}`;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  await db.update(outboundMessages).set({ status: "failed", lastError: error.slice(0, 500) }).where(eq(outboundMessages.id, row.id));
  console.error(`[mailer] Postmark send failed (outbound_messages ${row.id}): ${error}`);
  throw new DomainError("email_failed");
}
