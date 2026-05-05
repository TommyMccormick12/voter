export type Stance = 'strongly_support' | 'support' | 'neutral' | 'oppose' | 'strongly_oppose';

export type EventType =
  | 'view_candidate'
  | 'view_comparison'
  | 'rank_issues'
  | 'ranking_completed'
  | 'card_shared'
  | 'share'
  | 'return_visit';

export interface Race {
  id: string;
  state: string;
  district: string | null;
  office: string;
  election_date: string;
  cycle: number;
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
}

export interface Issue {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  active: boolean;
}

export interface CandidatePosition {
  id: string;
  candidate_id: string;
  issue_id: string;
  stance: Stance;
  summary: string;
  source_url: string | null;
}

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
