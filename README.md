# voter

A scorecard-and-LLM-match tool for the **2026 federal midterm primaries**
(House, Senate, Governor — May–September 2026). Voters enter a ZIP, browse
party-themed candidate scorecards, and get a personalized ranking via free-text
input matched against synthesized candidate stances.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · Tailwind 4 · Supabase
(Postgres + PostGIS + RLS) · Anthropic Claude Haiku 4.5.

## Current coverage

- **Scope:** Florida primaries on **August 18, 2026** (Tier 1 + Tier 2 in progress).
- **38 race rows** seeded covering Tier 1 House (FL-10/13/15/23/27/28 × R+D),
  Senate R+D, Governor R+D, plus Tier 2 House (FL-11/16/17/18/19 × R+D and
  more).
- **18 active candidates** across 12 races with synthesized stances +
  voting records + donor industry classifications. Empty races render a
  "Curating — check back soon" state (honest, not broken). Single- and
  two-candidate races soft-disable the match flow with informative copy
  (match comparison only delivers signal at 3+).
- **1,396 FL ZIPs** map to all 28 Congressional Districts via the HUD
  USPS_ZIP_CROSSWALK quarterly file.
- Live at <https://voter-fawn.vercel.app> with auto-deploy on push to main.

Differentiator vs ISideWith / Vote Smart: every stance carries a
*track-record note* that surfaces gaps (or alignment) between stated
positions, voting record, and donor profile. Citations are validated
against the real voting record — fabricated bill IDs are rejected at
synthesis time.

## Quick start

```bash
git clone https://github.com/TommyMccormick12/voter.git
cd voter
npm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY at minimum
# (the runtime hard-errors without them — no silent mock fallback).
npm run dev
```

Open <http://localhost:3000>, enter a Florida ZIP like `32801` (Orlando)
or `33101` (Miami) to see the FL primaries on that ballot.

When `ANTHROPIC_API_KEY` is unset, `/api/match` falls back to a
deterministic local heuristic so the match flow still works without
hitting Haiku.

## Routes

- `/` — ZIP entry → routes to race-picker
- `/race-picker?zip=32801` — federal primaries near you
- `/scorecards/[raceId]` — party-themed candidate carousel (4-col grid
  on desktop, scroll-snap on mobile)
- `/candidate/[slug]` — full record: stated stances, donors, voting
  record, statements
- `/match?race=…` — 5-issue weighted poll + free-text matcher
- `/match/results?race=…` — ranked candidates with match scores
- `/share?race=…&c=…&s=…` — shareable party-themed match card with
  `/api/og` image
- `/data-rights` — anonymous export / delete / opt-out
- `/privacy`, `/terms` — legal
- `/admin` — read-only engagement dashboard (HTTP Basic Auth via
  `ADMIN_PASSWORD`); top races by views, top saved candidates, open
  report queue, Anthropic spend estimate

Every write endpoint (`/api/interaction`, `/api/visit`, `/api/quick-poll`,
`/api/consent`, `/api/report`, `/api/match`) is rate-limited per session
and per IP. The Report Inaccurate path (`/api/report`) backs a "this
stance is wrong" button on every candidate page; reports queue in the
admin dashboard for manual review.

## Adding a race (offline pipeline)

The data pipeline (FEC + Wikipedia + GovTrack + Haiku synthesis +
inconsistency flagging + Supabase seed) is documented in
[`scripts/README.md`](./scripts/README.md). End-to-end per race is
~10 min wall-clock at free-tier API rates (Anthropic Haiku ~$0.01/race,
no other paid keys required for FL Tier 1 coverage).

For ZIP coverage, run `npm run ingest:hud-zips -- --file PATH` against
HUD's quarterly USPS_ZIP_CROSSWALK XLSX (sign up free at
https://www.huduser.gov/portal/datasets/usps_crosswalk.html).

## Common commands

| | |
|---|---|
| `npm run dev` | start the dev server |
| `npm run build` | production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest run |
| `npm run ingest:fec -- --race-id … --state … --district … --office H --primary-party R` | first step of the pipeline |
| `npm run ingest:platform -- --race-id …` | Wikipedia "Political positions" → Haiku |
| `npm run ingest:campaign-site -- --race-id …` | Playwright fallback for candidates without Wikipedia |
| `npm run synth:stances -- --race-id …` | Haiku-synthesize top_stances |
| `npm run synth:flag -- --race-id …` | inconsistency check before activation |
| `npm run review:preview -- --slug …` | render a single-file HTML preview of a candidate's scorecard |
| `npm run seed:candidates -- --race-id …` | upsert into Supabase |

See `package.json` for the full script list and `scripts/README.md` for
the pipeline walkthrough.

## Where to read next

- [`CLAUDE.md`](./CLAUDE.md) — architecture, design decisions, project
  structure, data flow
- [`scripts/README.md`](./scripts/README.md) — end-to-end data pipeline
- [`.env.example`](./.env.example) — every env var documented with
  sourcing URLs

## Deploy

The app deploys to Vercel. `middleware.ts` issues anonymous session
cookies, captures utm_*, and gates `/admin` behind HTTP Basic Auth.
Required env vars in Vercel project settings:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `IP_HASH_SECRET` — HMAC key for IP/UA hashing (32+ random bytes; in
  PowerShell: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
- `ADMIN_PASSWORD` — gates the `/admin` dashboard; username is always
  `admin`. Server-only, no `NEXT_PUBLIC_` prefix.
- `SUPABASE_SERVICE_ROLE_KEY` — required for `/api/report` insert + admin
  reads (RLS-bypass; never exposed to the client).

Optional: `ANTHROPIC_API_KEY` (live Haiku match — falls back to a local
heuristic when unset), `MATCH_API_DISABLED` (kill switch).

Migrations 008 (`races` RLS) and 009 (`candidate_reports`) must be applied
to the Supabase project. See `supabase/migrations/`.

## License

MIT. Voter data captured by this tool is public record (FEC filings,
GovTrack voting records, Wikipedia, candidate campaign sites). The
codebase is open-source so any civic-tech contributor can extend
coverage to additional states.
