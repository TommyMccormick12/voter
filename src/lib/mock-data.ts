// Mock data for federal midterm primary races (2026)
// Used while the real data pipeline is being built. Replace with Supabase
// queries once seed scripts are run. All names are fictional placeholders.

import type {
  Race,
  Candidate,
  CandidateDonor,
  CandidateTopIndustry,
  CandidateVote,
  CandidateStatement,
  CandidateWithFullData,
} from '@/types/database';

// ============================================================
// Races: federal midterm primaries May–September 2026
// ============================================================
export const MOCK_RACES: Race[] = [
  {
    id: 'race-nj-07',
    state: 'NJ',
    district: '07',
    office: 'U.S. House',
    election_date: '2026-06-02',
    cycle: 2026,
    election_type: 'primary',
    primary_party: 'R',
  },
  {
    id: 'race-va-sen',
    state: 'VA',
    district: null,
    office: 'U.S. Senate',
    election_date: '2026-06-16',
    cycle: 2026,
    election_type: 'primary',
    primary_party: 'D',
  },
  {
    id: 'race-ny-17',
    state: 'NY',
    district: '17',
    office: 'U.S. House',
    election_date: '2026-06-23',
    cycle: 2026,
    election_type: 'primary',
    primary_party: 'D',
  },
  {
    id: 'race-md-gov',
    state: 'MD',
    district: null,
    office: 'Governor',
    election_date: '2026-06-23',
    cycle: 2026,
    election_type: 'primary',
    primary_party: 'D',
  },
  {
    id: 'race-co-08',
    state: 'CO',
    district: '08',
    office: 'U.S. House',
    election_date: '2026-06-30',
    cycle: 2026,
    election_type: 'primary',
    primary_party: 'R',
  },
];

// ============================================================
// Candidates per race — with rich top_stances + track records
// ============================================================
export const MOCK_CANDIDATES: Record<string, CandidateWithFullData[]> = {
  'race-nj-07': [
    buildCandidate({
      id: 'cand-nj07-kean',
      name: 'Thomas Kean Jr.',
      slug: 'thomas-kean-jr',
      party: 'Republican',
      primary_party: 'R',
      state: 'NJ',
      district: '07',
      race_id: 'race-nj-07',
      office: 'U.S. House',
      incumbent: true,
      total_raised: 4_250_000,
      bio: 'Two-term Republican incumbent representing NJ-07. Former state senator and son of former Governor Tom Kean.',
      website: 'https://example.com/kean',
      photo_url: null,
      stances: [
        {
          issue_slug: 'economy',
          stance: 'support',
          summary: 'Tax cuts for small businesses and middle-class families. Opposes proposed 2026 corporate tax hike.',
          confidence: 88,
          track_record_note: 'Voted YES on H.R.1 (tax extension) in 2024',
        },
        {
          issue_slug: 'climate',
          stance: 'neutral',
          summary: 'Supports clean energy investment but opposes mandates. Backs nuclear and natural gas expansion.',
          confidence: 75,
          track_record_note: 'Voted NAY on Clean Energy Standard in 2025; top donor industry: oil & gas',
        },
        {
          issue_slug: 'immigration',
          stance: 'oppose',
          summary: 'Stricter border enforcement, end of catch-and-release, expanded deportations.',
          confidence: 92,
          track_record_note: 'Co-sponsored H.R.2 Border Act in 2024',
        },
        {
          issue_slug: 'healthcare',
          stance: 'oppose',
          summary: 'Repeal-and-replace ACA. Supports HSAs and interstate insurance competition.',
          confidence: 80,
        },
        {
          issue_slug: 'guns',
          stance: 'support',
          summary: 'Strong Second Amendment defender. Opposes assault weapon bans.',
          confidence: 95,
          track_record_note: 'A+ NRA rating',
        },
      ],
      top_industries: [
        { name: 'Real Estate', amount: 425_000, rank: 1 },
        { name: 'Securities & Investment', amount: 380_000, rank: 2 },
        { name: 'Oil & Gas', amount: 290_000, rank: 3 },
        { name: 'Insurance', amount: 245_000, rank: 4 },
        { name: 'Health Professionals', amount: 198_000, rank: 5 },
      ],
      donors: [
        { name: 'Goldman Sachs', industry: 'Securities', amount: 45_000 },
        { name: 'Blackstone', industry: 'Real Estate', amount: 38_000 },
        { name: 'ExxonMobil PAC', industry: 'Oil & Gas', amount: 35_000 },
      ],
      votes: [
        { bill_id: 'hr-1-119', title: 'Tax Cuts and Jobs Act Extension', vote: 'yea', date: '2024-11-15', issues: ['economy', 'taxes'] },
        { bill_id: 'hr-2-119', title: 'Secure the Border Act', vote: 'yea', date: '2024-09-20', issues: ['immigration'] },
        { bill_id: 'hr-845-119', title: 'Clean Energy Standard Act', vote: 'nay', date: '2025-02-10', issues: ['climate'] },
      ],
      statements: [
        {
          text: 'We need a secure border before we can have any conversation about reform.',
          context: 'tv_debate',
          date: '2025-08-12',
          issues: ['immigration'],
        },
        {
          text: 'Energy independence means an all-of-the-above approach. Solar, nuclear, and yes, natural gas.',
          context: 'town_hall',
          date: '2026-03-04',
          issues: ['climate', 'economy'],
        },
      ],
    }),
    buildCandidate({
      id: 'cand-nj07-mehta',
      name: 'Priya Mehta',
      slug: 'priya-mehta',
      party: 'Republican',
      primary_party: 'R',
      state: 'NJ',
      district: '07',
      race_id: 'race-nj-07',
      office: 'U.S. House',
      incumbent: false,
      total_raised: 875_000,
      bio: 'Tech entrepreneur and first-time candidate. Founded a cybersecurity startup acquired in 2023.',
      website: 'https://example.com/mehta',
      photo_url: null,
      stances: [
        {
          issue_slug: 'economy',
          stance: 'strongly_support',
          summary: 'Pro-business, lower regulation, expand R&D tax credits. Wants to bring back Trump-era tax structure.',
          confidence: 85,
        },
        {
          issue_slug: 'immigration',
          stance: 'support',
          summary: 'Border security plus expanded H-1B and merit-based legal immigration for tech workers.',
          confidence: 78,
        },
        {
          issue_slug: 'climate',
          stance: 'oppose',
          summary: 'Skeptical of climate mandates. Supports market-driven innovation, opposes EV subsidies.',
          confidence: 70,
        },
        {
          issue_slug: 'education',
          stance: 'support',
          summary: 'School choice expansion. Federal student debt forgiveness opposed.',
          confidence: 82,
        },
      ],
      top_industries: [
        { name: 'Technology', amount: 285_000, rank: 1 },
        { name: 'Venture Capital', amount: 180_000, rank: 2 },
        { name: 'Securities & Investment', amount: 95_000, rank: 3 },
      ],
      donors: [
        { name: 'Sequoia Capital partners', industry: 'Venture Capital', amount: 32_000 },
        { name: 'Andreessen Horowitz', industry: 'Venture Capital', amount: 28_000 },
      ],
      votes: [],
      statements: [
        {
          text: 'I built a company in this district. I know what it takes to compete and create jobs.',
          context: 'campaign_video',
          date: '2026-02-14',
          issues: ['economy'],
        },
      ],
    }),
    buildCandidate({
      id: 'cand-nj07-romano',
      name: 'David Romano',
      slug: 'david-romano',
      party: 'Republican',
      primary_party: 'R',
      state: 'NJ',
      district: '07',
      race_id: 'race-nj-07',
      office: 'U.S. House',
      incumbent: false,
      total_raised: 540_000,
      bio: 'Local school board member and small business owner. Hardline conservative platform.',
      website: 'https://example.com/romano',
      photo_url: null,
      stances: [
        {
          issue_slug: 'immigration',
          stance: 'strongly_oppose',
          summary: 'Mass deportation, end birthright citizenship, complete border wall.',
          confidence: 95,
        },
        {
          issue_slug: 'guns',
          stance: 'strongly_support',
          summary: 'No new gun laws. Constitutional carry. Repeal NJ assault weapon ban.',
          confidence: 98,
        },
        {
          issue_slug: 'education',
          stance: 'strongly_support',
          summary: 'School choice, end DEI in schools, parental rights legislation.',
          confidence: 92,
        },
        {
          issue_slug: 'criminal_justice',
          stance: 'oppose',
          summary: 'Tougher sentencing, expand law enforcement funding, oppose bail reform.',
          confidence: 88,
        },
      ],
      top_industries: [
        { name: 'Construction', amount: 85_000, rank: 1 },
        { name: 'Small Business', amount: 62_000, rank: 2 },
      ],
      donors: [
        { name: 'NJ Builders Association', industry: 'Construction', amount: 18_000 },
      ],
      votes: [],
      statements: [
        {
          text: 'The border crisis is the issue. Until we fix it, nothing else matters.',
          context: 'press_release',
          date: '2026-04-01',
          issues: ['immigration'],
        },
      ],
    }),
    buildCandidate({
      id: 'cand-nj07-park',
      name: 'Janet Park',
      slug: 'janet-park',
      party: 'Republican',
      primary_party: 'R',
      state: 'NJ',
      district: '07',
      race_id: 'race-nj-07',
      office: 'U.S. House',
      incumbent: false,
      total_raised: 320_000,
      bio: 'Retired Army colonel and former pharmaceutical executive. Moderate Republican lane.',
      website: 'https://example.com/park',
      photo_url: null,
      stances: [
        {
          issue_slug: 'foreign_policy',
          stance: 'strongly_support',
          summary: 'Strong NATO support, sustained Ukraine aid, hawkish on China.',
          confidence: 95,
        },
        {
          issue_slug: 'healthcare',
          stance: 'neutral',
          summary: 'Reform ACA, lower drug prices through Medicare negotiation, expand HSAs.',
          confidence: 72,
        },
        {
          issue_slug: 'climate',
          stance: 'support',
          summary: 'Carbon pricing, expand nuclear, market-based emission reductions.',
          confidence: 80,
        },
      ],
      top_industries: [
        { name: 'Pharmaceuticals', amount: 145_000, rank: 1 },
        { name: 'Defense', amount: 98_000, rank: 2 },
        { name: 'Healthcare Services', amount: 65_000, rank: 3 },
      ],
      donors: [
        { name: 'Pfizer PAC', industry: 'Pharmaceuticals', amount: 22_000 },
        { name: 'Lockheed Martin', industry: 'Defense', amount: 15_000 },
      ],
      votes: [],
      statements: [
        {
          text: 'I served 28 years to defend this country. I know what real threats look like, and I know what real leadership requires.',
          context: 'tv_debate',
          date: '2026-04-22',
          issues: ['foreign_policy'],
        },
      ],
    }),
  ],

  'race-va-sen': [
    buildCandidate({
      id: 'cand-va-sen-warner',
      name: 'Mark Warner',
      slug: 'mark-warner',
      party: 'Democrat',
      primary_party: 'D',
      state: 'VA',
      district: null,
      race_id: 'race-va-sen',
      office: 'U.S. Senate',
      incumbent: true,
      total_raised: 12_400_000,
      bio: 'Three-term Democratic incumbent. Senate Intelligence Committee chair.',
      website: 'https://example.com/warner',
      photo_url: null,
      stances: [
        {
          issue_slug: 'foreign_policy',
          stance: 'strongly_support',
          summary: 'Strong on Ukraine, NATO, intelligence community priorities.',
          confidence: 96,
          track_record_note: 'Voted YES on Ukraine supplemental in 2024',
        },
        {
          issue_slug: 'economy',
          stance: 'support',
          summary: 'Pro-business Democrat. Backs CHIPS Act, infrastructure spending.',
          confidence: 90,
        },
        {
          issue_slug: 'healthcare',
          stance: 'support',
          summary: 'Expand ACA subsidies, allow Medicare drug negotiation, oppose Medicare for All.',
          confidence: 85,
        },
      ],
      top_industries: [
        { name: 'Securities & Investment', amount: 1_240_000, rank: 1 },
        { name: 'Technology', amount: 980_000, rank: 2 },
        { name: 'Lawyers/Law Firms', amount: 845_000, rank: 3 },
      ],
      donors: [],
      votes: [
        { bill_id: 's-2226-118', title: 'Ukraine Security Supplemental Appropriations', vote: 'yea', date: '2024-04-23', issues: ['foreign_policy'] },
      ],
      statements: [],
    }),
    buildCandidate({
      id: 'cand-va-sen-kaur',
      name: 'Priya Kaur',
      slug: 'priya-kaur',
      party: 'Democrat',
      primary_party: 'D',
      state: 'VA',
      district: null,
      race_id: 'race-va-sen',
      office: 'U.S. Senate',
      incumbent: false,
      total_raised: 1_850_000,
      bio: 'Progressive challenger. Civil rights attorney and former state senator.',
      website: 'https://example.com/kaur',
      photo_url: null,
      stances: [
        {
          issue_slug: 'healthcare',
          stance: 'strongly_support',
          summary: 'Medicare for All. Eliminate private insurance for primary care.',
          confidence: 98,
        },
        {
          issue_slug: 'climate',
          stance: 'strongly_support',
          summary: 'Green New Deal framework, ban new fossil fuel leases, carbon tax.',
          confidence: 94,
        },
        {
          issue_slug: 'criminal_justice',
          stance: 'strongly_support',
          summary: 'End cash bail, decriminalize drugs, federal sentencing reform.',
          confidence: 96,
        },
      ],
      top_industries: [
        { name: 'Lawyers/Law Firms', amount: 380_000, rank: 1 },
        { name: 'Education', amount: 215_000, rank: 2 },
      ],
      donors: [],
      votes: [],
      statements: [],
    }),
  ],

  'race-ny-17': [
    buildCandidate({
      id: 'cand-ny17-jones',
      name: 'Marcus Jones',
      slug: 'marcus-jones',
      party: 'Democrat',
      primary_party: 'D',
      state: 'NY',
      district: '17',
      race_id: 'race-ny-17',
      office: 'U.S. House',
      incumbent: true,
      total_raised: 3_200_000,
      bio: 'First-term Democratic incumbent. Former Westchester County legislator.',
      website: 'https://example.com/jones',
      photo_url: null,
      stances: [
        {
          issue_slug: 'housing',
          stance: 'strongly_support',
          summary: 'Federal housing tax credit expansion, eviction protection, local zoning reform incentives.',
          confidence: 92,
        },
        {
          issue_slug: 'climate',
          stance: 'support',
          summary: 'Renewable energy investment, EV tax credits, opposes natural gas expansion.',
          confidence: 88,
        },
      ],
      top_industries: [
        { name: 'Real Estate', amount: 320_000, rank: 1 },
        { name: 'Lawyers/Law Firms', amount: 280_000, rank: 2 },
      ],
      donors: [],
      votes: [
        { bill_id: 'hr-7024-118', title: 'Tax Relief for American Families and Workers Act', vote: 'yea', date: '2024-01-31', issues: ['economy', 'taxes'] },
      ],
      statements: [],
    }),
    buildCandidate({
      id: 'cand-ny17-cohen',
      name: 'Sarah Cohen',
      slug: 'sarah-cohen',
      party: 'Democrat',
      primary_party: 'D',
      state: 'NY',
      district: '17',
      race_id: 'race-ny-17',
      office: 'U.S. House',
      incumbent: false,
      total_raised: 1_400_000,
      bio: 'Moderate Democrat challenger. Former Wall Street executive turned philanthropist.',
      website: 'https://example.com/cohen',
      photo_url: null,
      stances: [
        {
          issue_slug: 'economy',
          stance: 'support',
          summary: 'Pro-business Democrat. Wants to keep TCJA individual rates, modest corporate increase.',
          confidence: 80,
        },
        {
          issue_slug: 'immigration',
          stance: 'support',
          summary: 'Comprehensive reform: pathway to citizenship + tougher border enforcement.',
          confidence: 85,
        },
      ],
      top_industries: [
        { name: 'Securities & Investment', amount: 480_000, rank: 1 },
        { name: 'Real Estate', amount: 195_000, rank: 2 },
      ],
      donors: [],
      votes: [],
      statements: [],
    }),
  ],

  'race-md-gov': [],
  'race-co-08': [],
};

// ============================================================
// Helpers
// ============================================================

interface BuildCandidateInput {
  id: string;
  name: string;
  slug: string;
  party: string;
  primary_party: string;
  state: string;
  district: string | null;
  race_id: string;
  office: string;
  incumbent: boolean;
  total_raised: number;
  bio: string;
  website: string;
  photo_url: string | null;
  stances: Array<{
    issue_slug: string;
    stance: 'strongly_support' | 'support' | 'neutral' | 'oppose' | 'strongly_oppose';
    summary: string;
    confidence: number;
    track_record_note?: string;
  }>;
  top_industries: Array<{ name: string; amount: number; rank: number }>;
  donors: Array<{ name: string; industry: string; amount: number }>;
  votes: Array<{
    bill_id: string;
    title: string;
    vote: 'yea' | 'nay' | 'present' | 'absent' | 'no_vote';
    date: string;
    issues: string[];
  }>;
  statements: Array<{
    text: string;
    context:
      | 'town_hall'
      | 'tv_debate'
      | 'op_ed'
      | 'tweet'
      | 'press_release'
      | 'interview'
      | 'speech'
      | 'campaign_video';
    date: string;
    issues: string[];
  }>;
}

function buildCandidate(input: BuildCandidateInput): CandidateWithFullData {
  const top_stances = input.stances.map((s) => ({
    stance_id: `${input.slug}-${s.issue_slug}`,
    issue_slug: s.issue_slug,
    stance: s.stance,
    summary: s.summary,
    source_url: input.website,
    confidence: s.confidence,
    track_record_note: s.track_record_note,
  }));

  const top_industries: CandidateTopIndustry[] = input.top_industries.map((ti) => ({
    id: `${input.id}-ind-${ti.rank}`,
    candidate_id: input.id,
    industry_name: ti.name,
    industry_code: null,
    amount: ti.amount,
    rank: ti.rank,
    cycle: 2026,
    data_source: 'mock',
  }));

  const donors: CandidateDonor[] = input.donors.map((d, i) => ({
    id: `${input.id}-don-${i}`,
    candidate_id: input.id,
    donor_name: d.name,
    donor_type: 'pac',
    industry: d.industry,
    amount_total: d.amount,
    cycle: 2026,
    fec_committee_id: null,
    data_source: 'mock',
    rank_in_candidate: i + 1,
    fetched_at: new Date().toISOString(),
  }));

  const voting_record: CandidateVote[] = input.votes.map((v, i) => ({
    id: `${input.id}-vote-${i}`,
    candidate_id: input.id,
    bill_id: v.bill_id,
    bill_title: v.title,
    bill_summary: null,
    vote: v.vote,
    issue_slugs: v.issues,
    vote_date: v.date,
    source: 'propublica',
    source_url: `https://www.congress.gov/bill/${v.bill_id}`,
    significance: 'major',
  }));

  const statements: CandidateStatement[] = input.statements.map((s, i) => ({
    id: `${input.id}-stmt-${i}`,
    candidate_id: input.id,
    statement_text: s.text,
    statement_date: s.date,
    context: s.context,
    issue_slugs: s.issues,
    source_url: input.website,
    source_quality: 75,
  }));

  return {
    id: input.id,
    name: input.name,
    slug: input.slug,
    party: input.party,
    state: input.state,
    district: input.district,
    race_id: input.race_id,
    office: input.office,
    photo_url: input.photo_url,
    bio: input.bio,
    website: input.website,
    active: true,
    primary_party: input.primary_party,
    incumbent: input.incumbent,
    total_raised: input.total_raised,
    top_stances,
    top_industries,
    donors,
    voting_record,
    statements,
    positions: [],
  };
}

export function getMockRace(raceId: string): Race | null {
  return MOCK_RACES.find((r) => r.id === raceId) ?? null;
}

export function getMockCandidatesForRace(raceId: string): CandidateWithFullData[] {
  return MOCK_CANDIDATES[raceId] ?? [];
}

export function getMockCandidateBySlug(slug: string): CandidateWithFullData | null {
  for (const candidates of Object.values(MOCK_CANDIDATES)) {
    const found = candidates.find((c) => c.slug === slug);
    if (found) return found;
  }
  return null;
}

// Simple zip → primary races lookup (federal-only)
// Real implementation will use US Census Geocoding API.
const ZIP_TO_RACE_IDS: Record<string, string[]> = {
  '07059': ['race-nj-07'], // Somerset, NJ
  '07924': ['race-nj-07'], // Bernardsville, NJ
  '08807': ['race-nj-07'], // Bridgewater, NJ
  '22030': ['race-va-sen'], // Fairfax, VA
  '23230': ['race-va-sen'], // Richmond, VA
  '10502': ['race-ny-17'], // Ardsley, NY
  '10591': ['race-ny-17'], // Tarrytown, NY
  '21401': ['race-md-gov'], // Annapolis, MD
  '80016': ['race-co-08'], // Aurora, CO
};

export function getMockRacesForZip(zip: string): Race[] {
  const raceIds = ZIP_TO_RACE_IDS[zip] ?? [];
  return raceIds.map((id) => getMockRace(id)).filter((r): r is Race => r !== null);
}
