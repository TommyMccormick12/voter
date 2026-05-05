@AGENTS.md

# Voter - Candidate Comparison Platform

## Architecture
- **Frontend:** Next.js 15 (App Router) + React + Tailwind CSS
- **Backend/DB:** Supabase (Postgres + PostGIS)
- **Hosting:** Vercel
- **Auth:** None yet (anonymous sessions via localStorage token)

## Key Design Decisions
- Anonymous sessions tracked via crypto-random token in localStorage
- All user behavior stored with session_id for future account linking
- Geography (zip → state/district) is required for data value
- Issue priority RANKING (not binary agree/disagree) is the core interaction
- Schema designed for SQL analytics queries (the B2B data product)

## Data Flow
1. User lands → session created with random token
2. User enters zip → session updated with geography
3. User ranks issues → issue_rankings table (timestamped for longitudinal tracking)
4. User compares candidates → candidate_comparisons table
5. All page views/clicks → engagement_events table

## Project Structure
```
src/
  app/              # Next.js pages (App Router)
    page.tsx        # Landing - zip code entry
    races/          # Browse races by location
    compare/        # Side-by-side candidate comparison
    priorities/     # Issue ranking interface
  lib/
    supabase.ts     # Supabase client
    session.ts      # Anonymous session management
    events.ts       # Behavioral event tracking
  types/
    database.ts     # TypeScript types matching DB schema
  components/       # Shared UI components
supabase/
  migrations/       # SQL migration files
```

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
