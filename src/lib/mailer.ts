import type { DB } from "@/db";
import { outboundMessages } from "@/db/schema";
import { emailProvider } from "./config";

/**
 * Email channel behind a small adapter. Only the "dev" provider exists so far: it writes the
 * message to the outbox for the local dev inbox (/dev/inbox) and sends nothing.
 * A real provider is an open decision (see docs/DECISIONS.md).
 */
export async function sendEmail(db: DB, msg: { to: string; subject: string; body: string }) {
  const provider = emailProvider();
  if (provider !== "dev") {
    throw new Error(`Email provider "${provider}" is not implemented yet`);
  }
  await db.insert(outboundMessages).values({
    channel: "email",
    recipient: msg.to,
    subject: msg.subject,
    body: msg.body,
    provider: "dev",
    status: "dev_inbox",
  });
}
