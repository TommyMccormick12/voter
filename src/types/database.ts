// Database types — kept in sync with supabase/migrations/*

/**
 * How strongly a candidate holds the opinion stated in the stance `summary`.
 *
 * DEFINITION (Tommy, 2026-08-07): **a stance is an opinion someone holds.**
 * The opinion is the `summary` sentence. This field is its intensity — it is
 * NOT the candidate's agreement or disagreement with the `issue_slug` topic
 * name. "immigration + support" does not mean "supports immigration"; it
 * means the candidate firmly holds the immigration position the summary
 * describes, whatever direction that is.
 *
 * Because the field inverts when read against a bare topic label, it is not
 * rendered as a chip beside the topic anywhere in the UI (that pairing
 * produced "EDUCATION · Oppose" for a candidate who founded a school). It is
 * retained as a matching signal only — see buildStancesBlock in
 * src/lib/llm/match.ts, which passes it to the model alongside the summary.
 */
export type Stance = 'strongly_support' | 'support' | 'neutral' | 'oppose' | 'strongly_oppose';

export type ElectionType = 'primary' | 'general' | 'runoff';

export type InteractionAction =
  | 'viewed'
  | 'saved'
  | 'unsaved'
  | 'viewed_detail'
  | 'viewed_donors'
  | 'viewed_votes'
  | 'viewed_statements'
  | 'source_clicked'
  | 'no_action';

export type ConsentType = 'analytics' | 'data_sale' | 'marketing' | 'functional';

export type DeviceType = 'mobile' | 'desktop' | 'tablet';

export type Vote = 'yea' | 'nay' | 'present' | 'absent' | 'no_vote';

export type DonorType =
  | 'individual'
  | 'pac'
  | 'super_pac'
  | 'corporation'
  | 'union'
  | 'industry_aggregate';

export type DataSource =
  | 'ballotpedia'
  | 'opensecrets'
  | 'fec'
  | 'propublica'
  | 'govtrack'
  | 'congress_gov'
  | 'voteview'
  | 'campaign_site'
  | 'news'
  | 'followthemoney'
  | 'hand_curated'
  | 'mock';

export type StatementContext =
  | 'town_hall'
  | 'tv_debate'
  | 'op_ed'
  | 'tweet'
  | 'press_release'
  | 'interview'
  | 'speech'
  | 'campaign_video'
  | 'news';

// ============================================================
// Core entities
// ============================================================

export interface Race {
  id: string;
  state: string;
  district: string | null;
  office: string;
  election_date: string;
  cycle: number;
  election_type: ElectionType;
  primary_party: string | null;
  /** True when a qualified candidate advances unopposed (Spec A5, T06).
   * Not yet backed by a DB column — no migration or seed script writes
   * this today, so every read returns `false` (boundary.ts reads it
   * defensively; toRace() never fabricates a value). Wired through end
   * to end now, mirroring the `fec_coverage_end_date` precedent on
   * Candidate, so a future migration + seed_races.ts change lights it
   * up without a UI change. See src/lib/data/races.ts header comment
   * for the exact migration + seed requirement. */
  no_primary: boolean;
  /** Display copy for the no-primary state, e.g. "No primary — Maxwell
   * Alejandro Frost qualified unopposed and advances." Same not-yet-
   * backed-by-a-column caveat as `no_primary` above. */
  no_primary_note: string | null;
}

export interface Candidate {
  id: string;
  name: string;
  slug: string;
  party: string | null;
  state: string;
  district: string | null;
  race_id: string | null;
  office: string;
  photo_url: string | null;
  bio: string | null;
  website: string | null;
  active: boolean;
  primary_party: string | null;
  incumbent: boolean;
  total_raised: number | null;
  /** Last date FEC's filings cover for `total_raised` (Spec B3). Backed
   * by candidates.fec_coverage_end_date (migration 014); stamped by
   * fetch_fec.ts from FEC totals coverage_end_date and persisted by
   * seed_candidates.ts, selected via CANDIDATE_BASE_COLUMNS. NULL means
   * unknown (rows seeded before the next money re-pull) and DonorProfile
   * renders no coverage date — never inferred or guessed. */
  fec_coverage_end_date: string | null;
  top_stances: TopStance[];
}

export interface Issue {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  active: boolean;
}

// Denormalized cache attached to candidates.top_stances
export interface TopStance {
  stance_id: string;
  issue_slug: string;
  stance: Stance;
  summary: string;
  source_url: string;
  source_excerpt?: string;
  confidence: number;
  track_record_note?: string;
  track_record_citations?: string[];
}

export interface CandidatePosition {
  id: string;
  candidate_id: string;
  issue_id: string;
  stance: Stance;
  summary: string;
  source_url: string | null;
  confidence: number;
  source_type: DataSource | null;
  source_excerpt: string | null;
  sourced_at: string | null;
}

export interface CandidateDonor {
  id: string;
  candidate_id: string;
  donor_name: string;
  donor_type: DonorType | null;
  industry: string | null;
  amount_total: number;
  cycle: number;
  fec_committee_id: string | null;
  data_source: DataSource;
  rank_in_candidate: number | null;
  fetched_at: string;
}

export interface CandidateTopIndustry {
  id: string;
  candidate_id: string;
  industry_name: string;
  industry_code: string | null;
  amount: number;
  rank: number;
  cycle: number;
  data_source: DataSource;
}

export interface CandidateVote {
  id: string;
  candidate_id: string;
  bill_id: string;
  bill_title: string;
  bill_summary: string | null;
  vote: Vote;
  issue_slugs: string[];
  vote_date: string;
  source: DataSource | null;
  source_url: string | null;
  significance: 'major' | 'routine' | 'procedural' | null;
}

export interface CandidateStatement {
  id: string;
  candidate_id: string;
  statement_text: string;
  statement_date: string | null;
  context: StatementContext | null;
  issue_slugs: string[];
  source_url: string | null;
  source_quality: number;
}

// ============================================================
// User behavior tables
// ============================================================

export interface Session {
  id: string;
  session_token: string;
  zip_code: string | null;
  state: string | null;
  district: string | null;
  created_at: string;
  last_active: string;
  consent_analytics: boolean;
  consent_data_sale: boolean;
  consent_recorded_at: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer_domain: string | null;
  device_type: DeviceType | null;
  browser_family: string | null;
  return_visit_count: number;
  first_visit_at: string | null;
}

export interface SessionVisit {
  id: string;
  session_id: string;
  visit_started_at: string;
  visit_ended_at: string | null;
  pages_viewed: number;
  ip_country: string | null;
  ip_region: string | null;
  user_agent_hash: string | null;
}

export interface ConsentEvent {
  id: string;
  session_id: string;
  consent_type: ConsentType;
  granted: boolean;
  granted_at: string;
  ip_hash: string | null;
  user_agent_hash: string | null;
}

export interface ConsentState {
  analytics: boolean;
  data_sale: boolean;
  marketing: boolean;
  functional: boolean; // always true (strictly necessary)
  version: number;
  recorded_at: string;
}

export interface CandidateInteraction {
  id: string;
  session_id: string;
  candidate_id: string;
  race_id: string;
  action: InteractionAction;
  view_order: number | null;
  dwell_ms: number | null;
  created_at: string;
}

export interface QuickPollResponse {
  id: string;
  session_id: string;
  race_id: string;
  issue_id: string;
  weight: number;
  created_at: string;
}

export interface LlmMatch {
  id: string;
  session_id: string | null;
  free_text: string;
  free_text_hash: string;
  race_id: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  ranked_candidates: MatchResult[];
  created_at: string;
}

// ============================================================
// Computed result types (not table-backed)
// ============================================================

export interface AggregatedPriority {
  issue_id: string;
  issue_name: string;
  avg_rank: number;
  count: number;
  zip_code: string;
}

export interface PercentileResult {
  issue_id: string;
  issue_name: string;
  user_rank: number;
  percentile: number;
}

export interface MatchResult {
  candidate_id: string;
  score: number;
  matched_stances: string[];
  rationale: string;
}

export interface CandidateWithFullData extends Candidate {
  positions?: CandidatePosition[];
  donors?: CandidateDonor[];
  top_industries?: CandidateTopIndustry[];
  voting_record?: CandidateVote[];
  statements?: CandidateStatement[];
}
