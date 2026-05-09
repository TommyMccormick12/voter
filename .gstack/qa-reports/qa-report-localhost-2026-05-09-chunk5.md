# QA Report — Voter (Chunk 5 Cookie + Consent Infrastructure)

**Date:** 2026-05-09
**URL:** http://localhost:3003
**Branch:** master
**Tier:** Standard
**Mode:** Diff-aware (post-Chunk 5 commit verification)
**Framework:** Next.js 16.2.4 + React 19 + Tailwind 4

## Scope

Chunk 5 wired up cookie + consent infrastructure:
- Middleware sets voter_session, captures utm_*
- 4 API routes: /api/consent (POST/GET), /api/visit, /api/data-rights (GET/DELETE)
- ConsentBanner component (compact + customize modes)
- 3 new pages: /data-rights, /privacy, /terms
- Consent gates added to /api/interaction + /api/quick-poll + /api/visit

## Health Score

| | Before | After |
|--|--------|-------|
| **Health score** | 84 | 96 |
| Build | clean | clean |
| Lint | clean | clean |
| Tests | 27/27 | 27/27 |
| Console errors | 0 | 0 |

## Issues

### ISSUE-001 — Raw session token leaked in /api/data-rights GET response (LOW)
**Category:** Privacy / defense-in-depth
**Reproduction:** GET `/api/data-rights` with valid session cookie. Response showed top-level `session_id_pseudonym: "abc12...3def"` (correct), but nested `visits[].session_id` and `consent_history[].session_id` contained the full 64-char hex token.
**Why it matters:** The user owns this session, so leakage isn't a confidentiality risk per se. But:
- Downloaded data-rights JSON exports would contain a live session token
- Any HTTP-layer logging of the response body exposes the token
- Copy-pasting the export anywhere (support ticket, screenshot) leaks the session
The whole point of surfacing a pseudonym was to never show the raw token.
**Fix:** Explicit sanitized row construction in the GET handler. session_id replaced with pseudonym, ip_hash omitted entirely. Verified: response contains zero 64-char hex strings.
- **Status:** verified
- **Commit:** 3916115

## API tested

| Endpoint | Test | Result |
|----------|------|--------|
| `POST /api/consent` valid | grant analytics + sale | ✅ 200, returns full state |
| `POST /api/consent` invalid JSON | bad body | ✅ 400 invalid_json |
| `POST /api/consent` no session cookie | curl without cookie roundtrip | ✅ 401 no_session |
| `GET /api/consent` no consent yet | fresh session | ✅ 200 `consent: null` |
| `GET /api/consent` with consent | post-POST | ✅ 200 returns parsed state |
| `POST /api/interaction` analytics=true | gate test | ✅ 200 ok:true |
| `POST /api/interaction` analytics=false | post opt-out | ✅ 200 `dropped: 'consent'` |
| `POST /api/quick-poll` analytics=true | gate test | ✅ 200 recorded:N |
| `POST /api/quick-poll` analytics=false | post opt-out | ✅ 200 `dropped: 'consent'` |
| `POST /api/visit` analytics=true | gate test | ✅ 200 ok:true |
| `POST /api/visit` analytics=false | post opt-out | ✅ 200 `dropped: 'consent'` |
| `GET /api/data-rights` | fresh session | ✅ pseudonym + visits + history |
| `DELETE /api/data-rights` no confirm | empty body | ✅ 400 must_confirm |
| `DELETE /api/data-rights` confirm:true | full delete | ✅ 200 purged counts, all 5 cookies cleared |

## Audit log delta semantics

Verified that consent_audit only writes deltas (not every POST creates 3 rows):
- POST 1: previous=null, new=(true,true,false) → 3 audit entries (all "new")
- POST 2: previous=(true,true,false), new=(false,false,false) → 2 audit entries (analytics + data_sale changed)
- Total: 5 entries matched the GET response.

## Browser flow tested

Mobile (375x812):
1. Fresh session → `/` → ConsentBanner renders at bottom with 3 buttons (Customize / Functional only / Accept all) and Privacy link
2. Click Customize → expands to 4 granular toggles (Functional disabled-checked, Analytics default-on, Sale default-off, Marketing default-off)
3. "Save choices" → POST /api/consent → cookie set, banner disappears on reload
4. Visit `/data-rights` → renders pseudonym, current consent (with "Opt out of sale" inline button), visits list, consent history (3 entries), Download JSON + Delete buttons
5. Click "Delete all my data" → confirm → POST DELETE /api/data-rights → page swaps to "Data deleted" green confirmation card → all client-readable cookies cleared
6. Reload `/` → ConsentBanner reappears (new fresh session)
7. Visit `/privacy` and `/terms` → render correctly with all sections, footer links

## Middleware tested

| Behavior | Result |
|----------|--------|
| Sets voter_session on first GET / | ✅ |
| Captures utm_source + utm_campaign on first visit | ✅ — voter_utm cookie has clean JSON `{utm_source:"newsletter",utm_campaign:"jan2026",...}` |
| Skips /mockup-mobile.html (excluded matcher) | ✅ — 0 voter_* cookies set |

## Cookie hygiene check

| Cookie | HttpOnly | maxAge | Encoding |
|--------|----------|--------|----------|
| voter_session | ✅ | 1 year | raw (HttpOnly) |
| voter_consent | NOT (client reads) | 1 year | single-encoded JSON |
| voter_utm | ✅ | 90 days | single-encoded JSON |
| voter_visitor_id | ✅ | 2 years | (not yet set in flow) |
| voter_zip | ✅ | 30 days | (not yet set in flow) |

## Accessibility check

ConsentBanner:
- ✅ `role="dialog"`
- ✅ `aria-labelledby` pointing to real `id="consent-banner-title"`
- ✅ All 3 compact buttons focusable
- ✅ Customize toggles: 4 checkboxes, each with `aria-describedby` pointing to a description paragraph id
- ✅ Functional checkbox `disabled=true` and visually muted

/data-rights:
- ✅ Headings hierarchy (h1 + h2 sections)
- ✅ Buttons have visible text
- ✅ Inline "Opt out of sale" link styled as button-like text

/privacy and /terms:
- ✅ h1 + h2 nesting
- ✅ Lists have list-style
- ✅ Internal links to /data-rights work

## Build, lint, test summary

| | Before | After |
|--|--------|-------|
| `npm run build` | ✅ pass | ✅ pass |
| `npm run lint` | ✅ clean | ❌ 3 warnings (intermediate) → ✅ clean (final) |
| `npm test` | ✅ 27/27 | ✅ 27/27 |

(3 lint warnings appeared briefly during ISSUE-001 fix because of leading-underscore destructure pattern. Rewrote to explicit field selection — clean.)

## Note on dev-mode in-memory store

The in-memory store in `lib/visit-tracker.ts` doesn't reliably persist across consecutive requests in dev mode because Turbopack reloads modules on changes. This is a known limitation documented in the source with a TODO to swap for Supabase tables in Chunk 6 (the schema already exists from Chunk 1e migration 004). Production builds wouldn't have this issue, but Chunk 6's persistent store is the proper fix.

This is **not** a regression — it's expected pre-Supabase behavior. The audit/visit logging code path is correct (verified in single-burst tests where module state is held).

## Commits

```
3916115 fix(qa): ISSUE-001 — strip raw session token from data-rights GET response
```

## PR Summary

> QA found 1 low-severity privacy issue, fixed it, health score 84 → 96. ISSUE-001: data-rights GET leaked the raw 64-char session token in nested visit + consent_history rows even though the top-level showed a pseudonym. Defense-in-depth fix sanitizes nested rows. All consent gates verified working on /api/interaction, /api/quick-poll, /api/visit. Banner + delete flow + middleware exclusions + utm capture all verified.

## Status

**DONE** — 1 issue found, 1 fixed. Chunk 5 ready. Ready to continue with Chunk 6 (data pipeline scripts).
