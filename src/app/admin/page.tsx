// Admin dashboard (Phase 2D-quat §19.5). Read-only top-line metrics so
// you can tell what's working without flying blind.
//
// Auth: HTTP Basic via src/middleware.ts gate on /admin/*. The single
// env var ADMIN_PASSWORD must be set; otherwise middleware returns 503.
//
// Queries run with the service-role Supabase client (RLS-bypass)
// because some of the tables (llm_matches, candidate_reports, etc.)
// have no public SELECT policy. The service-role key is server-only;
// it never leaks to the client because this is a server component.

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic'; // always fresh — no static cache

// Haiku pricing (Claude 3.5 Haiku, current): rough estimate for the
// spend display. Update if Anthropic changes pricing.
const HAIKU_INPUT_USD_PER_M = 0.8;
const HAIKU_OUTPUT_USD_PER_M = 4.0;

interface Counts {
  sessions24h: number;
  sessions7d: number;
  visits24h: number;
  visits7d: number;
  interactions24h: number;
  interactions7d: number;
  matches24h: number;
  matches7d: number;
  matchTokensIn30d: number;
  matchTokensOut30d: number;
  matchSpend30dUsd: number;
  openReports: number;
  pollResponses7d: number;
}
interface TopRace {
  race_id: string;
  views: number;
}
interface TopCandidate {
  candidate_id: string;
  saves: number;
}
interface ReportRow {
  id: string;
  candidate_id: string;
  category: string;
  description: string;
  created_at: string;
  stance_id: string | null;
}
interface IpCluster {
  /** First 12 chars of the hex ip_hash — enough to disambiguate, short enough to fit a column. */
  ipHashShort: string;
  /** Total reports from this ip_hash in the window. */
  count: number;
  /** Distinct candidate_ids targeted — proxy for "spray attack vs. one-issue legit user". */
  distinctCandidates: number;
}

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadCounts(sb: ReturnType<typeof svc>): Promise<Counts> {
  const now = new Date();
  const t24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const t7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const t30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  async function cnt(table: string, since: string, col = 'created_at'): Promise<number> {
    const { count } = await sb.from(table).select('*', { count: 'exact', head: true }).gte(col, since);
    return count ?? 0;
  }

  const [
    sessions24h,
    sessions7d,
    visits24h,
    visits7d,
    interactions24h,
    interactions7d,
    matches24h,
    matches7d,
    pollResponses7d,
  ] = await Promise.all([
    cnt('sessions', t24h),
    cnt('sessions', t7d),
    cnt('session_visits', t24h, 'visit_started_at'),
    cnt('session_visits', t7d, 'visit_started_at'),
    cnt('candidate_interactions', t24h),
    cnt('candidate_interactions', t7d),
    cnt('llm_matches', t24h),
    cnt('llm_matches', t7d),
    cnt('quick_poll_responses', t7d),
  ]);

  // Haiku spend over 30 days
  const { data: matchTokens } = await sb
    .from('llm_matches')
    .select('input_tokens, output_tokens')
    .gte('created_at', t30d);
  const matchTokensIn30d = (matchTokens ?? []).reduce(
    (s: number, r: { input_tokens: number | null }) => s + (r.input_tokens ?? 0),
    0,
  );
  const matchTokensOut30d = (matchTokens ?? []).reduce(
    (s: number, r: { output_tokens: number | null }) => s + (r.output_tokens ?? 0),
    0,
  );
  const matchSpend30dUsd =
    (matchTokensIn30d / 1_000_000) * HAIKU_INPUT_USD_PER_M +
    (matchTokensOut30d / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;

  const { count: openReports } = await sb
    .from('candidate_reports')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');

  return {
    sessions24h,
    sessions7d,
    visits24h,
    visits7d,
    interactions24h,
    interactions7d,
    matches24h,
    matches7d,
    matchTokensIn30d,
    matchTokensOut30d,
    matchSpend30dUsd,
    openReports: openReports ?? 0,
    pollResponses7d,
  };
}

async function loadTopRaces(sb: ReturnType<typeof svc>): Promise<TopRace[]> {
  const t7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('candidate_interactions')
    .select('race_id')
    .eq('action', 'viewed')
    .gte('created_at', t7d);
  const counts: Record<string, number> = {};
  for (const r of (data as Array<{ race_id: string }>) ?? []) {
    counts[r.race_id] = (counts[r.race_id] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([race_id, views]) => ({ race_id, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);
}

async function loadTopSaved(sb: ReturnType<typeof svc>): Promise<TopCandidate[]> {
  const t7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('candidate_interactions')
    .select('candidate_id')
    .eq('action', 'saved')
    .gte('created_at', t7d);
  const counts: Record<string, number> = {};
  for (const r of (data as Array<{ candidate_id: string }>) ?? []) {
    counts[r.candidate_id] = (counts[r.candidate_id] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([candidate_id, saves]) => ({ candidate_id, saves }))
    .sort((a, b) => b.saves - a.saves)
    .slice(0, 10);
}

// Surface clustered report submissions — same ip_hash hitting multiple
// reports in 7d. With the migration 010 partial unique index, exact
// duplicates are dedup'd at the DB layer; this view catches the next
// step up, where a spammer rotates description text but stays on one
// IP. Threshold of 3+ avoids surfacing legit "this whole candidate is
// inaccurate" users who file a small handful of reports.
async function loadSuspiciousIpClusters(
  sb: ReturnType<typeof svc>,
): Promise<IpCluster[]> {
  const t7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('candidate_reports')
    .select('ip_hash, candidate_id')
    .not('ip_hash', 'is', null)
    .gte('created_at', t7d);

  const byHash = new Map<string, { count: number; candidates: Set<string> }>();
  for (const row of (data as Array<{ ip_hash: string; candidate_id: string }>) ?? []) {
    let entry = byHash.get(row.ip_hash);
    if (!entry) {
      entry = { count: 0, candidates: new Set() };
      byHash.set(row.ip_hash, entry);
    }
    entry.count++;
    entry.candidates.add(row.candidate_id);
  }

  return Array.from(byHash.entries())
    .filter(([, entry]) => entry.count >= 3)
    .map(([ipHash, entry]) => ({
      ipHashShort: ipHash.slice(0, 12),
      count: entry.count,
      distinctCandidates: entry.candidates.size,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

async function loadOpenReports(sb: ReturnType<typeof svc>): Promise<ReportRow[]> {
  const { data } = await sb
    .from('candidate_reports')
    .select('id, candidate_id, category, description, created_at, stance_id')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20);
  return (data as ReportRow[]) ?? [];
}

export default async function AdminPage() {
  const sb = svc();
  const [counts, topRaces, topSaved, reports, ipClusters] = await Promise.all([
    loadCounts(sb),
    loadTopRaces(sb),
    loadTopSaved(sb),
    loadOpenReports(sb),
    loadSuspiciousIpClusters(sb),
  ]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">voter admin</h1>
        <p className="text-xs text-gray-400 font-mono">
          {new Date().toISOString()}
        </p>
      </div>

      {/* Top-line counts */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <Stat label="Sessions 24h" value={counts.sessions24h} />
        <Stat label="Visits 24h" value={counts.visits24h} />
        <Stat label="Interactions 24h" value={counts.interactions24h} />
        <Stat label="Matches 24h" value={counts.matches24h} />
        <Stat label="Sessions 7d" value={counts.sessions7d} muted />
        <Stat label="Visits 7d" value={counts.visits7d} muted />
        <Stat label="Interactions 7d" value={counts.interactions7d} muted />
        <Stat label="Matches 7d" value={counts.matches7d} muted />
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
            Top races by views (7d)
          </h2>
          {topRaces.length === 0 ? (
            <p className="text-sm text-gray-400">No views yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {topRaces.map((r) => (
                  <tr key={r.race_id} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 font-mono text-xs text-gray-700">{r.race_id}</td>
                    <td className="py-1.5 text-right font-semibold text-gray-900">{r.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
            Top saved candidates (7d)
          </h2>
          {topSaved.length === 0 ? (
            <p className="text-sm text-gray-400">No saves yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {topSaved.map((c) => (
                  <tr key={c.candidate_id} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 font-mono text-xs text-gray-700">{c.candidate_id}</td>
                    <td className="py-1.5 text-right font-semibold text-gray-900">{c.saves}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
            Anthropic spend (30d)
          </h2>
          <div className="bg-gray-50 rounded-xl px-5 py-4 border border-gray-200">
            <p className="text-3xl font-bold text-gray-900">
              ${counts.matchSpend30dUsd.toFixed(2)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {counts.matchTokensIn30d.toLocaleString()} in / {counts.matchTokensOut30d.toLocaleString()} out
            </p>
            <p className="text-[11px] text-gray-400 mt-3">
              vs. $100/day cap ≈ $3,000/30d. Spend cap configured at Anthropic dashboard.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
            Quick-poll responses (7d)
          </h2>
          <div className="bg-gray-50 rounded-xl px-5 py-4 border border-gray-200">
            <p className="text-3xl font-bold text-gray-900">
              {counts.pollResponses7d}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Issue-weight rows captured. B2B sentiment data feedstock.
            </p>
          </div>
        </section>
      </div>

      <section className="mb-10">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
          Suspicious IP clusters (7d, ≥3 reports)
        </h2>
        {ipClusters.length === 0 ? (
          <p className="text-sm text-gray-400">
            No clustered submissions — nothing above the 3-report threshold.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-200">
                <th className="py-2 text-left font-bold">ip_hash (prefix)</th>
                <th className="py-2 text-right font-bold">Reports</th>
                <th className="py-2 text-right font-bold">Distinct candidates</th>
              </tr>
            </thead>
            <tbody>
              {ipClusters.map((c) => (
                <tr
                  key={c.ipHashShort}
                  className="border-b border-gray-100 last:border-0"
                >
                  <td className="py-1.5 font-mono text-xs text-gray-700">
                    {c.ipHashShort}…
                  </td>
                  <td className="py-1.5 text-right font-semibold text-gray-900">
                    {c.count}
                  </td>
                  <td className="py-1.5 text-right text-gray-700">
                    {c.distinctCandidates}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
          Open reports ({counts.openReports})
        </h2>
        {reports.length === 0 ? (
          <p className="text-sm text-gray-400">No reports yet.</p>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <div key={r.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                <div className="flex items-start justify-between mb-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-gray-900">{r.candidate_id}</p>
                    {r.stance_id && (
                      <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                        stance: {r.stance_id}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-semibold">
                      {r.category}
                    </span>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray-700 leading-snug">{r.description}</p>
                <p className="text-[10px] font-mono text-gray-400 mt-2">id: {r.id}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div
      className={`rounded-xl px-4 py-3 border ${
        muted ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300'
      }`}
    >
      <p className={`text-[10px] font-bold uppercase tracking-wider ${muted ? 'text-gray-400' : 'text-gray-500'}`}>
        {label}
      </p>
      <p className={`text-2xl font-bold ${muted ? 'text-gray-600' : 'text-gray-900'} mt-1`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
