import { desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { outboundMessages } from "@/db/schema";
import { devToolsEnabled } from "@/lib/config";

/** Development-only inbox for messages the dev email provider "sent". Unavailable in production. */
export default async function DevInbox() {
  if (!devToolsEnabled()) notFound();
  const db = await getDb();
  const messages = await db.select().from(outboundMessages).orderBy(desc(outboundMessages.createdAt)).limit(50);
  return (
    <>
      <h1>Dev inbox</h1>
      <p className="muted">Development only. Nothing here was actually sent.</p>
      {messages.length === 0 && <p>No messages yet.</p>}
      {messages.map((m) => (
        <div className="card" key={m.id}>
          <div className="muted">{m.createdAt.toISOString()} · {m.channel} · to {m.recipient}</div>
          <strong>{m.subject}</strong>
          <pre>{linkify(m.body)}</pre>
        </div>
      ))}
    </>
  );
}

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part}>{part}</a> : <span key={i}>{part}</span>,
  );
}
