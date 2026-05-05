import { supabase } from './supabase';
import { getSessionId } from './session';
import { trackEvent } from './events';
import type { AggregatedPriority, PercentileResult } from '@/types/database';

const MINIMUM_THRESHOLD = 10;

export async function saveRankings(
  issueIds: string[]
): Promise<{ success: boolean; error?: string }> {
  if (issueIds.length === 0) {
    return { success: false, error: 'No issues to save' };
  }

  const sessionId = await getSessionId();
  if (!sessionId) {
    return { success: false, error: 'No active session' };
  }

  const rows = issueIds.map((issueId, index) => ({
    session_id: sessionId,
    issue_id: issueId,
    rank: index + 1,
  }));

  const { error } = await supabase.from('issue_rankings').insert(rows);

  if (error) {
    console.error('Failed to save rankings:', error.message);
    return { success: false, error: 'Failed to save rankings' };
  }

  await trackEvent('ranking_completed', {
    metadata: { issue_count: issueIds.length },
  });

  return { success: true };
}

export async function getAggregateByZip(
  zip: string
): Promise<AggregatedPriority[]> {
  const { data, error } = await supabase
    .from('issue_rankings')
    .select(`
      issue_id,
      rank,
      sessions!inner(zip_code),
      issues!inner(name)
    `)
    .eq('sessions.zip_code', zip);

  if (error) {
    console.error('Failed to fetch aggregates:', error.message);
    return [];
  }

  if (!data || data.length < MINIMUM_THRESHOLD) {
    return [];
  }

  const grouped: Record<string, { ranks: number[]; name: string }> = {};
  for (const row of data) {
    const id = row.issue_id;
    if (!grouped[id]) {
      grouped[id] = {
        ranks: [],
        name: (row as unknown as { issues: { name: string } }).issues.name,
      };
    }
    grouped[id].ranks.push(row.rank);
  }

  return Object.entries(grouped)
    .map(([issue_id, { ranks, name }]) => ({
      issue_id,
      issue_name: name,
      avg_rank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
      count: ranks.length,
      zip_code: zip,
    }))
    .sort((a, b) => a.avg_rank - b.avg_rank);
}

export async function getPercentile(
  userRanking: { id: string; slug: string }[],
  zip: string
): Promise<PercentileResult[]> {
  const aggregates = await getAggregateByZip(zip);

  if (aggregates.length === 0) {
    return getBaselinePercentile(userRanking);
  }

  return userRanking.map((issue, index) => {
    const userRank = index + 1;
    const agg = aggregates.find((a) => a.issue_id === issue.id);
    const percentile = agg
      ? Math.round(
          (aggregates.filter((a) => a.avg_rank > (agg?.avg_rank ?? 0)).length /
            aggregates.length) *
            100
        )
      : 50;

    return {
      issue_id: issue.id,
      issue_name: '',
      user_rank: userRank,
      percentile,
    };
  });
}

async function getBaselinePercentile(
  userRanking: { id: string; slug: string }[]
): Promise<PercentileResult[]> {
  const { data, error } = await supabase
    .from('baseline_rankings')
    .select('issue_slug, avg_rank, response_pct')
    .eq('year', 2025);

  if (error || !data) {
    return userRanking.map((issue, index) => ({
      issue_id: issue.id,
      issue_name: '',
      user_rank: index + 1,
      percentile: 50,
    }));
  }

  return userRanking.map((issue, index) => {
    const baseline = data.find((b) => b.issue_slug === issue.slug);
    const percentile = baseline ? Math.round(baseline.response_pct) : 50;

    return {
      issue_id: issue.id,
      issue_name: '',
      user_rank: index + 1,
      percentile,
    };
  });
}
