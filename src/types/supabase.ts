// Generated-style Supabase database types — T14 (Spec C1).
//
// Hand-derived from supabase/migrations/*.sql (the schema source of
// truth), because no local Supabase instance / CLI auth was available
// in this environment (`npx supabase gen types typescript --local`
// needs a running local stack; `--db-url` would need a production
// connection string this environment does not hold). Structured to
// match what `supabase gen types typescript` produces, so swapping in
// the real generated file later is a drop-in replacement.
//
// Column typing rule: a column gets a literal union only when the
// migration SQL backs it with a real CHECK constraint. Columns the app
// treats as enums by convention but the DB does not enforce (e.g.
// candidate_positions.stance — documented in a SQL comment, no CHECK;
// candidate_donors.donor_type; candidate_voting_record.significance)
// stay `string`, same as the CLI would emit. The stronger
// application-level unions live in src/types/database.ts and are
// applied by the boundary module (src/lib/data/boundary.ts), not by
// this raw schema layer.
//
// Covers every table created/altered through migration 010, including
// the three Phase 1 leftover tables (issue_rankings,
// candidate_comparisons, engagement_events) that still exist in the DB
// pending T25's staged drop.

import type { ElectionType, InteractionAction, ConsentType, Vote } from './database';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ReportCategory =
  | 'factual_error'
  | 'wrong_attribution'
  | 'outdated'
  | 'other';

export type ReportStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed';

export interface Database {
  public: {
    Tables: {
      races: {
        Row: {
          id: string;
          state: string;
          district: string | null;
          office: string;
          election_date: string;
          cycle: number;
          created_at: string | null;
          election_type: ElectionType;
          primary_party: string | null;
        };
        Insert: {
          id: string;
          state: string;
          district?: string | null;
          office: string;
          election_date: string;
          cycle: number;
          created_at?: string | null;
          election_type?: ElectionType;
          primary_party?: string | null;
        };
        Update: {
          id?: string;
          state?: string;
          district?: string | null;
          office?: string;
          election_date?: string;
          cycle?: number;
          created_at?: string | null;
          election_type?: ElectionType;
          primary_party?: string | null;
        };
        Relationships: [];
      };
      candidates: {
        Row: {
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
          active: boolean | null;
          created_at: string | null;
          primary_party: string | null;
          top_stances: Json | null;
          incumbent: boolean | null;
          total_raised: number | null;
          fec_coverage_end_date: string | null;
        };
        Insert: {
          id: string;
          name: string;
          slug: string;
          party?: string | null;
          state: string;
          district?: string | null;
          race_id?: string | null;
          office: string;
          photo_url?: string | null;
          bio?: string | null;
          website?: string | null;
          active?: boolean | null;
          created_at?: string | null;
          primary_party?: string | null;
          top_stances?: Json | null;
          incumbent?: boolean | null;
          total_raised?: number | null;
          fec_coverage_end_date?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          party?: string | null;
          state?: string;
          district?: string | null;
          race_id?: string | null;
          office?: string;
          photo_url?: string | null;
          bio?: string | null;
          website?: string | null;
          active?: boolean | null;
          created_at?: string | null;
          primary_party?: string | null;
          top_stances?: Json | null;
          incumbent?: boolean | null;
          total_raised?: number | null;
          fec_coverage_end_date?: string | null;
        };
        Relationships: [];
      };
      issues: {
        Row: {
          id: string;
          name: string;
          slug: string;
          category: string | null;
          description: string | null;
          active: boolean | null;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          category?: string | null;
          description?: string | null;
          active?: boolean | null;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          category?: string | null;
          description?: string | null;
          active?: boolean | null;
        };
        Relationships: [];
      };
      candidate_positions: {
        Row: {
          id: string;
          candidate_id: string | null;
          issue_id: string | null;
          stance: string;
          summary: string;
          source_url: string | null;
          updated_at: string | null;
          confidence: number | null;
          source_type: string | null;
          source_excerpt: string | null;
          sourced_at: string | null;
        };
        Insert: {
          id?: string;
          candidate_id?: string | null;
          issue_id?: string | null;
          stance: string;
          summary: string;
          source_url?: string | null;
          updated_at?: string | null;
          confidence?: number | null;
          source_type?: string | null;
          source_excerpt?: string | null;
          sourced_at?: string | null;
        };
        Update: {
          id?: string;
          candidate_id?: string | null;
          issue_id?: string | null;
          stance?: string;
          summary?: string;
          source_url?: string | null;
          updated_at?: string | null;
          confidence?: number | null;
          source_type?: string | null;
          source_excerpt?: string | null;
          sourced_at?: string | null;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          session_token: string;
          zip_code: string | null;
          state: string | null;
          district: string | null;
          created_at: string | null;
          last_active: string | null;
          consent_analytics: boolean | null;
          consent_data_sale: boolean | null;
          consent_recorded_at: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          referrer_domain: string | null;
          device_type: string | null;
          browser_family: string | null;
          return_visit_count: number | null;
          first_visit_at: string | null;
        };
        Insert: {
          id?: string;
          session_token: string;
          zip_code?: string | null;
          state?: string | null;
          district?: string | null;
          created_at?: string | null;
          last_active?: string | null;
          consent_analytics?: boolean | null;
          consent_data_sale?: boolean | null;
          consent_recorded_at?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          referrer_domain?: string | null;
          device_type?: string | null;
          browser_family?: string | null;
          return_visit_count?: number | null;
          first_visit_at?: string | null;
        };
        Update: {
          id?: string;
          session_token?: string;
          zip_code?: string | null;
          state?: string | null;
          district?: string | null;
          created_at?: string | null;
          last_active?: string | null;
          consent_analytics?: boolean | null;
          consent_data_sale?: boolean | null;
          consent_recorded_at?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          referrer_domain?: string | null;
          device_type?: string | null;
          browser_family?: string | null;
          return_visit_count?: number | null;
          first_visit_at?: string | null;
        };
        Relationships: [];
      };
      // ------------------------------------------------------------
      // Phase 1 leftovers — still present in the DB, staged for
      // removal by T25 (spec F2). Kept here so a query against them
      // (e.g. a cleanup script) stays typed until that ticket lands.
      // ------------------------------------------------------------
      issue_rankings: {
        Row: {
          id: string;
          session_id: string | null;
          issue_id: string | null;
          rank: number;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          issue_id?: string | null;
          rank: number;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          issue_id?: string | null;
          rank?: number;
          created_at?: string | null;
        };
        Relationships: [];
      };
      candidate_comparisons: {
        Row: {
          id: string;
          session_id: string | null;
          candidate_a_id: string | null;
          candidate_b_id: string | null;
          preferred_candidate_id: string | null;
          race_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          candidate_a_id?: string | null;
          candidate_b_id?: string | null;
          preferred_candidate_id?: string | null;
          race_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          candidate_a_id?: string | null;
          candidate_b_id?: string | null;
          preferred_candidate_id?: string | null;
          race_id?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      engagement_events: {
        Row: {
          id: string;
          session_id: string | null;
          event_type: string;
          candidate_id: string | null;
          issue_id: string | null;
          metadata: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          event_type: string;
          candidate_id?: string | null;
          issue_id?: string | null;
          metadata?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          event_type?: string;
          candidate_id?: string | null;
          issue_id?: string | null;
          metadata?: Json | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // ------------------------------------------------------------
      baseline_rankings: {
        Row: {
          id: string;
          issue_slug: string;
          avg_rank: number;
          response_pct: number;
          source: string;
          year: number;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          issue_slug: string;
          avg_rank: number;
          response_pct: number;
          source: string;
          year: number;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          issue_slug?: string;
          avg_rank?: number;
          response_pct?: number;
          source?: string;
          year?: number;
          created_at?: string | null;
        };
        Relationships: [];
      };
      candidate_interactions: {
        Row: {
          id: string;
          session_id: string | null;
          candidate_id: string | null;
          race_id: string | null;
          action: InteractionAction;
          view_order: number | null;
          dwell_ms: number | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          candidate_id?: string | null;
          race_id?: string | null;
          action: InteractionAction;
          view_order?: number | null;
          dwell_ms?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          candidate_id?: string | null;
          race_id?: string | null;
          action?: InteractionAction;
          view_order?: number | null;
          dwell_ms?: number | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      session_visits: {
        Row: {
          id: string;
          session_id: string | null;
          visit_started_at: string | null;
          visit_ended_at: string | null;
          pages_viewed: number | null;
          ip_country: string | null;
          ip_region: string | null;
          user_agent_hash: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          visit_started_at?: string | null;
          visit_ended_at?: string | null;
          pages_viewed?: number | null;
          ip_country?: string | null;
          ip_region?: string | null;
          user_agent_hash?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          visit_started_at?: string | null;
          visit_ended_at?: string | null;
          pages_viewed?: number | null;
          ip_country?: string | null;
          ip_region?: string | null;
          user_agent_hash?: string | null;
        };
        Relationships: [];
      };
      consent_audit: {
        Row: {
          id: string;
          session_id: string | null;
          consent_type: ConsentType;
          granted: boolean;
          granted_at: string | null;
          ip_hash: string | null;
          user_agent_hash: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          consent_type: ConsentType;
          granted: boolean;
          granted_at?: string | null;
          ip_hash?: string | null;
          user_agent_hash?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          consent_type?: ConsentType;
          granted?: boolean;
          granted_at?: string | null;
          ip_hash?: string | null;
          user_agent_hash?: string | null;
        };
        Relationships: [];
      };
      llm_matches: {
        Row: {
          id: string;
          session_id: string | null;
          free_text: string;
          free_text_hash: string;
          race_id: string | null;
          model: string;
          input_tokens: number | null;
          output_tokens: number | null;
          ranked_candidates: Json;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          free_text: string;
          free_text_hash: string;
          race_id?: string | null;
          model: string;
          input_tokens?: number | null;
          output_tokens?: number | null;
          ranked_candidates: Json;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          free_text?: string;
          free_text_hash?: string;
          race_id?: string | null;
          model?: string;
          input_tokens?: number | null;
          output_tokens?: number | null;
          ranked_candidates?: Json;
          created_at?: string | null;
        };
        Relationships: [];
      };
      quick_poll_responses: {
        Row: {
          id: string;
          session_id: string | null;
          race_id: string | null;
          issue_id: string | null;
          weight: number;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          race_id?: string | null;
          issue_id?: string | null;
          weight: number;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          race_id?: string | null;
          issue_id?: string | null;
          weight?: number;
          created_at?: string | null;
        };
        Relationships: [];
      };
      candidate_donors: {
        Row: {
          id: string;
          candidate_id: string | null;
          donor_name: string;
          donor_type: string | null;
          industry: string | null;
          amount_total: number | null;
          cycle: number;
          fec_committee_id: string | null;
          data_source: string | null;
          rank_in_candidate: number | null;
          fetched_at: string | null;
        };
        Insert: {
          id?: string;
          candidate_id?: string | null;
          donor_name: string;
          donor_type?: string | null;
          industry?: string | null;
          amount_total?: number | null;
          cycle: number;
          fec_committee_id?: string | null;
          data_source?: string | null;
          rank_in_candidate?: number | null;
          fetched_at?: string | null;
        };
        Update: {
          id?: string;
          candidate_id?: string | null;
          donor_name?: string;
          donor_type?: string | null;
          industry?: string | null;
          amount_total?: number | null;
          cycle?: number;
          fec_committee_id?: string | null;
          data_source?: string | null;
          rank_in_candidate?: number | null;
          fetched_at?: string | null;
        };
        Relationships: [];
      };
      candidate_top_industries: {
        Row: {
          id: string;
          candidate_id: string | null;
          industry_name: string;
          industry_code: string | null;
          amount: number | null;
          rank: number | null;
          cycle: number;
          data_source: string | null;
        };
        Insert: {
          id?: string;
          candidate_id?: string | null;
          industry_name: string;
          industry_code?: string | null;
          amount?: number | null;
          rank?: number | null;
          cycle: number;
          data_source?: string | null;
        };
        Update: {
          id?: string;
          candidate_id?: string | null;
          industry_name?: string;
          industry_code?: string | null;
          amount?: number | null;
          rank?: number | null;
          cycle?: number;
          data_source?: string | null;
        };
        Relationships: [];
      };
      candidate_voting_record: {
        Row: {
          id: string;
          candidate_id: string | null;
          bill_id: string;
          bill_title: string;
          bill_summary: string | null;
          vote: Vote;
          issue_slugs: string[] | null;
          vote_date: string;
          source: string | null;
          source_url: string | null;
          significance: string | null;
        };
        Insert: {
          id?: string;
          candidate_id?: string | null;
          bill_id: string;
          bill_title: string;
          bill_summary?: string | null;
          vote: Vote;
          issue_slugs?: string[] | null;
          vote_date: string;
          source?: string | null;
          source_url?: string | null;
          significance?: string | null;
        };
        Update: {
          id?: string;
          candidate_id?: string | null;
          bill_id?: string;
          bill_title?: string;
          bill_summary?: string | null;
          vote?: Vote;
          issue_slugs?: string[] | null;
          vote_date?: string;
          source?: string | null;
          source_url?: string | null;
          significance?: string | null;
        };
        Relationships: [];
      };
      candidate_statements: {
        Row: {
          id: string;
          candidate_id: string | null;
          statement_text: string;
          statement_date: string | null;
          context: string | null;
          issue_slugs: string[] | null;
          source_url: string | null;
          source_quality: number | null;
        };
        Insert: {
          id?: string;
          candidate_id?: string | null;
          statement_text: string;
          statement_date?: string | null;
          context?: string | null;
          issue_slugs?: string[] | null;
          source_url?: string | null;
          source_quality?: number | null;
        };
        Update: {
          id?: string;
          candidate_id?: string | null;
          statement_text?: string;
          statement_date?: string | null;
          context?: string | null;
          issue_slugs?: string[] | null;
          source_url?: string | null;
          source_quality?: number | null;
        };
        Relationships: [];
      };
      candidate_reports: {
        Row: {
          id: string;
          candidate_id: string | null;
          session_id: string | null;
          stance_id: string | null;
          cited_bill_id: string | null;
          category: ReportCategory;
          description: string;
          reporter_email: string | null;
          ip_hash: string | null;
          status: ReportStatus | null;
          created_at: string | null;
          reviewed_at: string | null;
          description_hash: string | null;
        };
        Insert: {
          id?: string;
          candidate_id?: string | null;
          session_id?: string | null;
          stance_id?: string | null;
          cited_bill_id?: string | null;
          category: ReportCategory;
          description: string;
          reporter_email?: string | null;
          ip_hash?: string | null;
          status?: ReportStatus | null;
          created_at?: string | null;
          reviewed_at?: string | null;
          description_hash?: string | null;
        };
        Update: {
          id?: string;
          candidate_id?: string | null;
          session_id?: string | null;
          stance_id?: string | null;
          cited_bill_id?: string | null;
          category?: ReportCategory;
          description?: string;
          reporter_email?: string | null;
          ip_hash?: string | null;
          status?: ReportStatus | null;
          created_at?: string | null;
          reviewed_at?: string | null;
          description_hash?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      // Recreated by migration 007 with a smaller column set than the
      // original 004 definition (no state/district/primary_party/
      // incumbent/industries_count/top_stances_count).
      candidate_data_completeness: {
        Row: {
          id: string;
          name: string;
          slug: string;
          positions_count: number;
          donors_count: number;
          votes_count: number;
          statements_count: number;
          active: boolean | null;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
