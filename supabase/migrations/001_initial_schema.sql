-- Core schema for voter comparison platform
-- Designed for: anonymous session tracking, issue priority ranking,
-- candidate comparison behavior, and geographic segmentation

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "postgis";

-- Races (election contests)
create table races (
  id uuid primary key default gen_random_uuid(),
  state char(2) not null,
  district varchar(10),
  office varchar(100) not null,
  election_date date not null,
  cycle smallint not null,
  created_at timestamptz default now()
);

create index idx_races_state_cycle on races(state, cycle);

-- Candidates
create table candidates (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,
  slug varchar(200) unique not null,
  party varchar(50),
  state char(2) not null,
  district varchar(10),
  race_id uuid references races(id),
  office varchar(100) not null,
  photo_url text,
  bio text,
  website varchar(500),
  active boolean default true,
  created_at timestamptz default now()
);

create index idx_candidates_state on candidates(state);
create index idx_candidates_race on candidates(race_id);
create index idx_candidates_slug on candidates(slug);

-- Issues (policy topics)
create table issues (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  slug varchar(100) unique not null,
  category varchar(50),
  description text,
  active boolean default true
);

-- Candidate positions on issues
create table candidate_positions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete cascade,
  issue_id uuid references issues(id) on delete cascade,
  stance varchar(50) not null, -- 'strongly_support', 'support', 'neutral', 'oppose', 'strongly_oppose'
  summary text not null,
  source_url text,
  updated_at timestamptz default now(),
  unique(candidate_id, issue_id)
);

-- Anonymous sessions
create table sessions (
  id uuid primary key default gen_random_uuid(),
  session_token varchar(64) unique not null,
  zip_code varchar(10),
  state char(2),
  district varchar(10),
  created_at timestamptz default now(),
  last_active timestamptz default now()
);

create index idx_sessions_geo on sessions(state, district);
create index idx_sessions_zip on sessions(zip_code);

-- Issue priority rankings (the core data product)
create table issue_rankings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  issue_id uuid references issues(id) on delete cascade,
  rank smallint not null,
  created_at timestamptz default now()
);

create index idx_rankings_session on issue_rankings(session_id);
create index idx_rankings_geo on issue_rankings(created_at);

-- Candidate comparisons (which candidate a user preferred)
create table candidate_comparisons (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  candidate_a_id uuid references candidates(id),
  candidate_b_id uuid references candidates(id),
  preferred_candidate_id uuid references candidates(id),
  race_id uuid references races(id),
  created_at timestamptz default now()
);

create index idx_comparisons_session on candidate_comparisons(session_id);
create index idx_comparisons_race on candidate_comparisons(race_id);

-- Engagement events (behavioral signals)
create table engagement_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  event_type varchar(50) not null, -- 'view_candidate', 'view_comparison', 'rank_issues', 'share', 'return_visit'
  candidate_id uuid references candidates(id),
  issue_id uuid references issues(id),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index idx_events_session on engagement_events(session_id);
create index idx_events_type on engagement_events(event_type, created_at);
create index idx_events_geo on engagement_events(created_at);

-- Row-level security policies (public read for candidates/issues, session-scoped write for user data)
alter table candidates enable row level security;
alter table issues enable row level security;
alter table candidate_positions enable row level security;
alter table sessions enable row level security;
alter table issue_rankings enable row level security;
alter table candidate_comparisons enable row level security;
alter table engagement_events enable row level security;

-- Public read access for reference data
create policy "Public read candidates" on candidates for select using (true);
create policy "Public read issues" on issues for select using (true);
create policy "Public read positions" on candidate_positions for select using (true);
