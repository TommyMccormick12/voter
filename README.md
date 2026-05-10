# voter

A scorecard-and-LLM-match tool for the **2026 federal midterm primaries**
(House, Senate, Governor — May–September 2026). Voters enter a zip, browse
party-themed candidate scorecards, and get a personalized ranking via free-text
input matched against synthesized candidate stances.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind 4 · Supabase
(Postgres + PostGIS + RLS) · Anthropic Claude Haiku 4.5.

## Quick start (mock data, no API keys needed)

```bash
git clone <repo> && cd voter
npm install
npm run dev
```

Open <http://localhost:3000>, enter zip `07059` to see the NJ-07 Republican primary
with mock candidates. The app ships with hardcoded fixtures for 5 races so the UI
works end-to-end without Supabase or any API keys.

When `ANTHROPIC_API_KEY` is unset, `/api/match` falls back to a deterministic local
heuristic so the match flow still works.

## What you get out of the box

- `/` — zip entry → routes to race-picker
- `/race-picker?zip=07059` — federal primaries near you
- `/scorecards/[raceId]` — party-themed candidate carousel (4-col grid on desktop, scroll-snap on mobile)
- `/candidate/[slug]` — full record: stated stances, donors, voting record, statements
- `/match?race=…` — 5-issue weighted poll + free-text matcher
- `/match/results?race=…` — ranked candidates with match scores
- `/share?race=…&c=…&s=…` — shareable party-themed match card with `/api/og` image
- `/data-rights` — anonymous export / delete / opt-out

## Adding a real race (Supabase + Haiku)

The full data pipeline (Ballotpedia + OpenSecrets + FEC + ProPublica + Haiku synthesis +
inconsistency flagging + seed) is documented in [`scripts/README.md`](./scripts/README.md).

Get free API keys for OpenSecrets, ProPublica, FEC, and a Supabase service-role key,
then run the steps in `scripts/README.md` for one race (NJ-07 takes ~10 min end to end).

## Common commands

| | |
|---|---|
| `npm run dev` | start the dev server |
| `npm run build` | production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest run |
| `npm run test:watch` | Vitest watch mode |
| `npm run ingest:ballotpedia -- --race-slug … --race-id …` | first step of the data pipeline |
| `npm run seed:candidates -- --race-id …` | last step of the data pipeline |

See `package.json` for the full script list and `scripts/README.md` for the pipeline walkthrough.

## Where to read next

- [`CLAUDE.md`](./CLAUDE.md) — full architecture, design decisions, project structure, data flow
- [`scripts/README.md`](./scripts/README.md) — end-to-end data pipeline (NJ-07 walkthrough)
- [`.env.example`](./.env.example) — every env var documented with sourcing URLs
- `public/mockup-mobile.html`, `public/mockup-desktop.html` — design source of truth

## Deploy

Vercel. The `middleware.ts` issues anonymous session cookies and captures utm_*.
Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and (optional)
`ANTHROPIC_API_KEY` in the Vercel project settings.
