# Candidate Connection extracts — 2026-08-07

Source material for the stance-authoring run (issue #8, ticket #11).
Verbatim Ballotpedia Candidate Connection survey answers for the 79
priority candidates (7 priority incumbents + top-2 by money in each
contested race), pulled manually from public pages per Decision 5 (no
paid API; sales quote still pending).

- `candidate-connection-extracts.json` — keyed by fixture slug. Each
  record: `ballotpedia_url`, `identity_verified`, `status`
  (`responded` / `no_response` / `page_not_found`), `campaign_website`
  (when listed), and verbatim `answers` (question + answer). Answers are
  UNEDITED source text — do not paraphrase them here; paraphrase happens
  only in synthesis, with citations.
- `summary.json` — coverage counts. 79/79 extracted, 44 responded,
  35 no_response, 0 page_not_found, 0 identity failures.

Extraction method: 8 parallel agents, each verifying the page belongs to
the 2026 FL candidacy for the exact race before extracting; wrong-person
grabs marked `page_not_found` rather than guessed. Per-record `notes`
carry caveats that MUST be honored downstream, notably:

- **anna-paulina-luna**: answers are from her **2022** survey (no 2026
  response exists). Treat as prior-cycle statements, never as current
  2026 platform.
- **darren-soto**: Ballotpedia states his Democratic primary was
  **canceled** (advances to the general). Verify against the DOE spine
  before ticket #13 activates anything in race-fl-09-d-2026 — this may
  be a `no_primary` informational state like FL-10 D (Frost).
- Several answers are cut off mid-sentence **on the source page itself**
  (brice-barnes, howard-sapp, angela-nixon endorsements); the truncation
  is Ballotpedia's, not an extraction error.
- A few `campaign_website` values were inferred from contact emails on
  the page rather than a direct link; per-record notes say which. Treat
  those as leads, not verified spine data.
