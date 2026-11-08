@AGENTS.md

# Project X

- Spec: `docs/Construction_App_Claude_Roadmap.md`. Status: `docs/ROADMAP.md`. Assumptions: `docs/DECISIONS.md`. Update ROADMAP.md and DECISIONS.md with every increment.
- Business rules and authorization live in `src/domain/`; pages and server actions in `src/app/` stay thin. Every domain function takes the acting user's ID and derives tenant scope from stored records.
- Every user-facing string goes in `src/i18n/en.ts`, `es.ts` and `ht.ts`. `tests/i18n.test.ts` fails if a key is missing.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`. Never edit an applied migration.
- Before finishing: `npm run typecheck && npm test && npm run build`.
- Synthetic data only. Never send real messages or provision paid services to test.
- On Windows the Bash tool may need `export PATH="$PATH:/c/Program Files/nodejs"`.
