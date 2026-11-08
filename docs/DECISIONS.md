# Decisions and assumptions

## Product decisions (from the product owner)

- Working name **Project X**; market **United States**; imperial units, US time zones.
- Languages: English, Spanish, Haitian Creole; per-user. Optional machine translation of user text shows original + labeled translation.
- Hierarchy: manager hires companies; their supervisors manage their own lower tier. Contact beyond downward + worker→own supervisor is manager-configured. Approval chain is manager-configured.
- Tasks: manager assigns to a company; supervisors delegate down.
- One global login across general contractors.
- No business SMS in the first release. Passkeys + email magic links for login; web push + email for notifications; built-in task messenger.
- Printable QR check-in first. Sign packs after tasks/photos.
- Pilot with two general contractors; tenants created manually.
- Stack: Next.js, Supabase, Vercel; Twilio later for optional SMS. Product owner owns the accounts.

## Implementation decisions (first increment, 2026-11-08)

1. **Embedded PGlite for local development and tests instead of the Supabase CLI.** Docker is not installed on the development machine, and the Supabase CLI's local stack needs it. PGlite is real Postgres compiled to WebAssembly, so the same SQL migrations run everywhere. Supabase is used through `DATABASE_URL` (its Postgres connection string). Limitation: one process at a time on the local database.
2. **App-owned authentication instead of Supabase Auth.** The spec puts passkeys first, and authorization must be enforced in the server layer anyway. Keeping sessions, magic links and (next) passkeys in the app avoids coupling to a provider's auth feature set. Supabase is then used for Postgres and, later, private file storage. Revisit if Supabase Auth's passkey support turns out to be a better fit.
3. **No row-level security yet.** The app server is the only database client and checks every access. When Supabase is connected, revoke the public `anon`/`authenticated` roles' access to these tables, or add RLS policies, so the Supabase REST API cannot bypass the app.
4. **Companies are per tenant.** The same real company working for two GCs exists as two company records; the person behind it shares one login. Keeps tenant isolation simple.
5. **Managers see the whole tenant.** Project-specific manager assignment (ProjectRole) is deferred until a pilot needs it.
6. **Supervisor powers (for now):** invite and approve workers of their own company. Only managers create or approve supervisors. Approval of lower-tier companies' workers by an upper-tier supervisor is not implemented yet.
7. **Several employers on one project:** check-in uses the earliest active engagement. A chooser is a follow-up.
8. **Stale visit threshold:** 12 hours (`STALE_VISIT_HOURS`). Placeholder; confirm with pilot users.
9. **Location:** readings less accurate than 100 m are "low accuracy"; a match is within max(75 m, reported accuracy) of the house's coordinates. Placeholders; GPS cannot tell adjacent houses apart.
10. **QR tokens:** 144-bit random, stored in plain text because they are public identifiers printed on signs, not secrets. Invite and login tokens are secrets and are stored hashed.
11. **Invite links** expire after 7 days; login links after 15 minutes.
12. **Translations** of interface strings were drafted by Claude and need native-speaker review before the pilot (Spanish and especially Haitian Creole).
13. **Next.js-generated `AGENTS.md`** is kept; `next dev` re-creates it.

## Open items

- Email-sending provider (needed before any real user can sign in).
- Translation provider for user-written text (must support Haitian Creole).
- Domain name.
