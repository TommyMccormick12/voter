# Decisions — 2026-08-06 grilling session

These are settled. `to-spec` inherits them; do not re-litigate per ticket. The seven technical "Decided constraints" in `TODOS.md` also stand. Source evaluations backing these: `DATA-SOURCES-2026-08-06.md`. Audit evidence: `DATA-AUDIT-2026-08-06.md`.

1. **Horizon:** FL primary (2026-08-18) only; product future decided after. Despite the short horizon, the **full rework** ships before the primary (Tommy's explicit call, twice confirmed).
2. **Ballot roster:** rebuilt from the FL Division of Elections qualified-candidate download (status = Qualified). FEC registrations are never again treated as candidacy.
3. **District routing:** self-hosted point-in-polygon on the official EOGPCRP2026 shapefile (new 28-district map) + free Census geocoder for address→lat/lon. No HUD, no Geocodio (HUD/Census district products still carry the old map).
4. **Address UX:** ZIP-first; street address requested only for split ZIPs; addresses geocoded and immediately discarded — only ZIP + resolved district stored.
5. **Stances:** entity spine (DOE roster + FEC candidate ID) is mandatory for every record. Sources in order: Ballotpedia Candidate Connection (manual pull from public pages now; API sales quote pursued in parallel), spine-seeded campaign sites, GDELT news mining (replaces NewsAPI). Wikipedia only behind a Wikidata candidacy-claim (P3602/P768) gate.
6. **Votes:** Congress.gov API (House, bioguide-keyed) + Voteview (Senate). All joins by ID via unitedstates/congress-legislators; name matching eliminated everywhere.
7. **Money:** FEC API by candidate ID with `cycle=2026` pinned; `coverage_end_date` shown next to every figure; re-pull after Aug 8 to capture pre-primary filings; no silent fallback to older cycles.
8. **Governor:** dropped entirely. Scope is genuinely federal-only; empty gov fixtures deleted; contradicting docs fixed.
9. **No-primary districts** (e.g. FL-10 D, Frost unopposed): informational state — "No primary — [name] qualified unopposed and advances" — with the scorecard still viewable. Never hide the race, never fake a contest.
10. **B2B engagement data:** active goal. Write path wired early and verified during primary-week traffic.
11. **Design:** evolve the current identity (party theming, carousel) on real tokens and shared primitives; mockup HTMLs retired.
12. **Authoring:** Fable authors and activates challenger stances solo. The waived human pre-approval is replaced by the adversarial verification gate in `../AGENT-ORCHESTRATION.md` (mechanical validation + blind refutation-first verifier; failures block activation; Tommy receives a post-activation digest).
13. **Deploy safety:** all work on a branch; `main` auto-deploys to production, so nothing merges to `main` without Tommy's explicit go.
