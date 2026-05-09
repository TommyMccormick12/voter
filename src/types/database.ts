// Database types — kept in sync with supabase/migrations/*

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
  | 'campaign_video';

export type EventType =
  | 'view_candidate'
  | 'view_comparison'
  | 'rank_issues'
  | 'ranking_completed'
  | 'card_shared'
  | 'share'
  | 'return_visit'
  | 'card_viewed'
  | 'card_saved'
  | 'card_unsaved'
  | 'match_completed'
  | 'view_donors'
  | 'view_voting_record'
  | 'view_statements'
  | 'consent_granted'
  | 'consent_revoked';

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

export interface IssueRanking {
  id: string;
  session_id: string;
  issue_id: string;
  rank: number;
  created_at: string;
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

export interface CandidateComparison {
  id: string;
  session_id: string;
  candidate_a_id: string;
  candidate_b_id: string;
  preferred_candidate_id: string | null;
  race_id: string;
  created_at: string;
}

export interface EngagementEvent {
  id: string;
  session_id: string;
  event_type: EventType;
  candidate_id: string | null;
  issue_id: string | null;
  metadata: Record<string, unknown>;
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
