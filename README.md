# HeyJobsite

Construction site check-in and accountability for general contractors. Mobile web app; no install needed.

The product spec is [docs/Construction_App_Claude_Roadmap.md](docs/Construction_App_Claude_Roadmap.md). Implementation status is in [docs/ROADMAP.md](docs/ROADMAP.md), design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and assumptions in [docs/DECISIONS.md](docs/DECISIONS.md).

## Requirements

- Node.js 22 or newer (tested with 26.13).
- Nothing else for local development: the database is an embedded PostgreSQL (PGlite) stored in `.data/`. Docker and Supabase are not needed yet.

## Setup

```sh
npm install
cp .env.example .env.local      # optional; defaults work locally
npm run db:migrate              # create the local database
npm run db:seed                 # load synthetic demo data (two contractor tenants)
npm run dev                     # http://localhost:3000
```

Stop `npm run dev` before running any `db:*` or `tenant:*` script: the embedded database allows one process at a time.

### Signing in locally

There are no passwords. The first sign-in on a device is by emailed link; in development nothing is sent and messages appear at **http://localhost:3000/dev/inbox**. After that the home page offers a passkey (face, fingerprint or screen lock), and the device stays signed in until 60 days without use. Passkeys work on `http://localhost:3000` and on HTTPS, not over a plain-HTTP LAN address. Seeded accounts:

| Email | Role |
|---|---|
| `admin@alpha.test` | Admin of tenant "Demo Alpha Builders" |
| `pat@plumbing.test` | Supervisor, Demo Plumbing Co |
| `john@drain.test` | Worker, Demo Drain Sub |
| `admin@bravo.test` | Admin of unrelated tenant "Demo Bravo Homes" |

On first sign-in everyone picks their language (English, Español, Kreyòl ayisyen); it can be changed later in Settings.

`npm run db:seed` prints a House 12 check-in link. Or sign in as `admin@alpha.test`, open the project, choose **Print QR** for a house, and open the link under the QR code.

To test on a phone on the same Wi-Fi, set `APP_BASE_URL=http://<your-computer-ip>:3000` in `.env.local` so QR codes point to your computer. Phone location access needs HTTPS except on localhost, so location will show as unavailable in that setup; check-in still works.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Automated tests (fresh in-memory database per test) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build |
| `npm run db:generate` | Create a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (local, or `DATABASE_URL` if set) |
| `npm run db:seed` | Load demo data (local only; refuses in production) |
| `npm run db:reset` | Delete the local database |
| `npm run tenant:create -- --name "Acme Builders" --admin-email owner@acme.com` | Create a pilot tenant (no public signup) |

## Environment variables

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string (e.g. Supabase). Empty = local embedded database. Required in production. |
| `APP_BASE_URL` | Public URL used in emailed links and printed QR codes. Required in production. |
| `PASSKEY_RP_ID` | Passkey domain. Production: `heyjobsite.com`. Empty = the `APP_BASE_URL` host. |
| `EMAIL_PROVIDER` | `dev` writes to the dev inbox; `postmark` sends real email. Production refuses `dev`. |
| `POSTMARK_SERVER_TOKEN` | Postmark Server API token (secret; set in Vercel, never committed). Production refuses Postmark's test token. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | Defaults `HeyJobsite <no-reply@mail.heyjobsite.com>` / `support@heyjobsite.com`. |

Never commit `.env.local` or real credentials.

## Verification

```sh
npm run typecheck && npm test && npm run build
```
