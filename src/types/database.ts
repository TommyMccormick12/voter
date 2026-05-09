// Database types — kept in sync with supabase/migrations/*

export type Stance = 'strongly_support' | 'support' | 'neutral' | 'oppose' | 'strongly_oppose';

export type ElectionType = 'primary' | 'general' | 'runoff';

export type SwipeDirection = 'right' | 'left' | 'save' | 'detail';

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
  | 'swipe_right'
  | 'swipe_left'
  | 'swipe_save'
  | 'swipe_detail'
  | 'match_completed'
  | 'view_donors'
  | 'view_voting_record'
  | 'view_statements';

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
}

export interface IssueRanking {
  id: string;
  session_id: string;
  issue_id: string;
  rank: number;
  created_at: string;
}

export interface CandidateSwipe {
  id: string;
  session_id: string;
  candidate_id: string;
  race_id: string;
  direction: SwipeDirection;
  swipe_order: number | null;
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
