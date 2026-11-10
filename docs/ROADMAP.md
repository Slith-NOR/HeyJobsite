# Implementation status

Spec: [Construction_App_Claude_Roadmap.md](Construction_App_Claude_Roadmap.md). Status values: **done**, **partial**, **planned**, **blocked**.

_Last updated: 2026-11-08 (first increment)._

## Phase 0 — Foundation: done

- Next.js 16 + TypeScript app, Drizzle ORM, SQL migrations in `drizzle/`.
- Local embedded Postgres (PGlite); `DATABASE_URL` switches to Supabase/any Postgres.
- Synthetic seed data for two unrelated tenants; operator script for pilot tenants.
- Production refuses fake email, missing `DATABASE_URL` or missing `APP_BASE_URL`.
- Translation files for English, Spanish and Haitian Creole; a test enforces every key and placeholder.

## Phase 1 — Projects, houses, companies, identities: partial

Done:
- Tenants, global users, tenant memberships (admin/manager).
- Companies, projects, houses (properties) with optional coordinates.
- Project-scoped subcontract engagements; cycle, self-hire, hiring-the-GC and orphan-hirer rejection; per-project chain positions.
- Supervisor/manager invite links (single use, 7-day expiry, hash stored) shown as link + QR.
- Pending → approved/rejected affiliations; no self-approval; supervisors approve workers, only managers approve supervisors.
- **No passwords anywhere.** Passkey sign-in (face, fingerprint or screen lock; discoverable credentials, so no email typed) and email magic links (single use, 15 min, POST confirmation against link scanners) as the way in on a new or lost device.
- Remembered sessions: stay signed in on a device until 60 days without use; revocable. Settings: list/remove passkeys, add one on this device, sign out all other devices.
- After signing in without a passkey, the home page offers to set one up.
- First sign-in language chooser (each option written in its own language); change later in Settings.
- User settings: name, unverified phone, language, translation toggle (stored; translation itself is a later phase).

Not yet:
- Passkey sign-in tested only with a software authenticator in automated tests; **not yet on real iPhone/Android devices**.
- Contact directory screen and ContactPolicy enforcement (table exists, not used yet).
- Adding further managers through the UI (domain function `addTenantMember` exists; no screen).
- Delegated approval down the chain (a supervisor approving a lower-tier company's workers).
- Postmark sending is built and tested against a fake Postmark; **not yet sent for real** (waiting for the Postmark account and DNS records).
- Per-device session list (only "sign out all other devices" exists).

## Phase 2 — Check-in/out and attendance: partial (QR method done)

Done:
- Printable QR per house (opaque token; revoke and regenerate).
- QR landing page: no site details for signed-out users; generic message for unauthorized users.
- Address confirmation → check in / check out with server timestamps and employer/engagement snapshot.
- One open visit per person, enforced by a database unique index; repeat scans idempotent; concurrent duplicates return the same visit.
- Open visit at another house must be checked out first; nothing is silently moved.
- Location captured only at the check-in/out tap, with purpose explanation; statuses denied / unavailable / low accuracy / no reference / matched / mismatch.
- Manager attendance board: worker, house, hiring chain, time, location status, stale flag (12 h), tap-to-call.

Not yet:
- Stale-visit reminders (needs notifications, Phase 4) and admin corrections with preserved original.
- Location-assisted selection and house codes (after the core flow).
- Choosing which employer to check in for when a person works for two engaged companies (currently the earliest engagement).
- Real-device testing on iPhone Safari and Android Chrome (**not done yet**).

## Phase 3 onward: planned

Tasks/photos (3), sign packs (2B, after 3), notifications and task conversations (4), Whereby walkthroughs (4B), pilot operations (5).
