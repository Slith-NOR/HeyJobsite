import { describe, expect, it } from "vitest";
import { outboundMessages } from "@/db/schema";
import { assertProductionSafe } from "@/lib/config";
import { sendEmail } from "@/lib/mailer";
import { freshDb } from "./helpers";

const env = { EMAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: "server-token-for-tests" } as unknown as NodeJS.ProcessEnv;
const msg = { to: "john@drain.test", subject: "Your HeyJobsite sign-in link", body: "Tap: https://app.heyjobsite.com/auth/verify?token=SECRET" };

/** Stands in for Postmark's API; records what would have been sent. Nothing leaves the machine. */
function fakePostmark(reply: { status: number; json: unknown } | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.json), { status: reply.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Postmark email", () => {
  it("sends with the server token, no link tracking, and logs delivery without the secret link", async () => {
    const db = await freshDb();
    const pm = fakePostmark({ status: 200, json: { ErrorCode: 0, Message: "OK", MessageID: "pm-123" } });
    await sendEmail(db, msg, { env, fetch: pm.f });

    expect(pm.calls).toHaveLength(1);
    expect(pm.calls[0].url).toBe("https://api.postmarkapp.com/email");
    expect((pm.calls[0].init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe("server-token-for-tests");
    const sent = JSON.parse(String(pm.calls[0].init.body));
    expect(sent).toMatchObject({
      From: "HeyJobsite <no-reply@mail.heyjobsite.com>",
      To: "john@drain.test",
      ReplyTo: "support@heyjobsite.com",
      TextBody: msg.body,
      TrackLinks: "None",
      TrackOpens: false,
    });

    const [row] = await db.select().from(outboundMessages);
    expect(row).toMatchObject({ provider: "postmark", status: "sent", providerMessageId: "pm-123", body: "" });
    expect(JSON.stringify(row)).not.toContain("SECRET");
  });

  it("reports a rejected or unreachable send as email_failed and records why", async () => {
    const db = await freshDb();
    const rejected = fakePostmark({ status: 422, json: { ErrorCode: 400, Message: "Sender signature not defined" } });
    await expect(sendEmail(db, msg, { env, fetch: rejected.f })).rejects.toThrow("email_failed");
    const down = fakePostmark(new TypeError("fetch failed"));
    await expect(sendEmail(db, msg, { env, fetch: down.f })).rejects.toThrow("email_failed");

    const rows = await db.select().from(outboundMessages);
    expect(rows.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(rows.some((r) => r.lastError?.includes("Sender signature not defined"))).toBe(true);
  });

  it("production refuses missing or test Postmark tokens and unknown providers", () => {
    const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x", APP_BASE_URL: "https://app.heyjobsite.com" };
    const check = (extra: object) => () => assertProductionSafe({ ...base, ...extra } as unknown as NodeJS.ProcessEnv);
    expect(check({ EMAIL_PROVIDER: "postmark" })).toThrow(/POSTMARK_SERVER_TOKEN is required/);
    expect(check({ EMAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: "POSTMARK_API_TEST" })).toThrow(/test token/);
    expect(check({ EMAIL_PROVIDER: "carrier-pigeon", POSTMARK_SERVER_TOKEN: "t" })).toThrow(/not supported/);
    expect(check({ EMAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: "real-looking-token" })).not.toThrow();
  });
});
