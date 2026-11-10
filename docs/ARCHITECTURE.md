# Architecture

## Overview

One Next.js application (App Router, server components and server actions) serves every tenant. All data access happens on the server; the browser never talks to the database directly.

```
src/
  app/        Pages and server actions (thin: read session, call domain, redirect)
  domain/     Business rules and authorization (pure functions taking a DB handle)
  db/         Drizzle schema and connection (PGlite locally, Postgres via DATABASE_URL)
  i18n/       en / es / ht dictionaries
  lib/        Config checks, crypto, session cookies, email adapter
drizzle/      Generated SQL migrations
scripts/      migrate, seed, reset, create-tenant
tests/        Vitest suites against a fresh in-memory database
```

## Authorization model

- **Tenant** = one general contractor account. Every tenant-owned row has `tenant_id`.
- **Users are global** (one login across tenants). Access comes from:
  - `tenant_memberships` (admin/manager): general-contractor staff, see the whole tenant.
  - `worker_affiliations` (worker/supervisor, pending/approved/revoked): employment with one company in one tenant.
- **Project access** for a worker = approved affiliation with a company that has an active engagement (by date, in the project's time zone) on that project.
- Domain functions take the acting user's ID and derive tenant scope from the stored record (project, property, company). Client-supplied tenant IDs in URLs are only used for routing and are checked against the record.
- A QR token identifies a property. It never grants access on its own.

Postgres row-level security is not used yet because the app is the only database client. Add it as defence in depth when connecting Supabase (see DECISIONS.md).

## Subcontract chain

`subcontract_engagements` holds project-scoped edges hiring company → hired company. Rules enforced in `createEngagement` inside a transaction that locks the project row:
- both companies in the project's tenant
- the hiring company is the GC or already hired on the project
- the GC is never hired
- no cycles (the hired company must not be an ancestor of the hiring company).

## Check-in

- `visits` has a partial unique index: one row per user where `checked_out_at is null`. This is the concurrency guarantee; the code catches the violation and returns the existing visit.
- Visits snapshot `company_id` and `engagement_id` at check-in, so later chain changes do not rewrite history.
- Location is optional and recorded with a status. `matched` means "consistent with the QR-selected house", never proof of presence.

## Login

No passwords. Two ways in:

- **Passkeys** (`domain/passkeys.ts`, `@simplewebauthn/server`): registration needs a signed-in session; sign-in uses discoverable credentials, so the device offers the account without typing an email. Only public keys are stored (`passkeys`). Challenges live in `webauthn_challenges`, single use, 5 minutes, referenced by an httpOnly cookie. The relying-party ID and origin come from `APP_BASE_URL`.
- **Email magic links**: a random 256-bit token, stored as SHA-256, single use, 15-minute expiry. The emailed URL opens a page with a button, so link-scanning email security tools cannot consume the token. This is also the recovery path for a new or lost phone.

Sessions are random tokens stored hashed in an httpOnly cookie. They end after 60 days without use (sliding expiry) or when revoked; Settings can sign out every other device.

## Email

`lib/mailer.ts` is the channel adapter. `dev` writes the whole message to `outbound_messages` for `/dev/inbox`; production refuses it. `postmark` sends through Postmark's HTTP API with tracking off and logs delivery status and Postmark's message ID in `outbound_messages`, without the body (sign-in links are secrets).

## Database environments

| Environment | Database |
|---|---|
| Tests | Fresh in-memory PGlite per test, migrations applied |
| Local dev | PGlite in `.data/pglite` (single process) |
| Staging/production | `DATABASE_URL` → Supabase Postgres via `postgres` driver |
