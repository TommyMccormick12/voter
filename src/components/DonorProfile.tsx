import type { CandidateDonor, CandidateTopIndustry } from '@/types/database';
import { getPartyTheme } from '@/lib/party-theme';

interface Props {
  topIndustries: CandidateTopIndustry[];
  donors: CandidateDonor[];
  totalRaised: number | null;
  primaryParty: string | null;
}

export function DonorProfile({
  topIndustries,
  donors,
  totalRaised,
  primaryParty,
}: Props) {
  const theme = getPartyTheme(primaryParty);
  const sortedIndustries = [...topIndustries].sort((a, b) => a.rank - b.rank);
  const maxAmount = sortedIndustries[0]?.amount ?? 1;
  const sortedDonors = [...donors]
    .sort((a, b) => (a.rank_in_candidate ?? 99) - (b.rank_in_candidate ?? 99))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {totalRaised !== null && (
        <div className={`${theme.heroBg} border ${theme.border} rounded-xl p-4`}>
          <p className={`text-xs font-bold ${theme.text} uppercase mb-1`}>
            2026 Cycle Total
          </p>
          <p className="text-3xl font-bold text-gray-900">
            ${(totalRaised / 1_000_000).toFixed(2)}M
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Source: OpenSecrets · FEC filings
          </p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3">TOP 5 INDUSTRIES</h3>
        <div className="space-y-3">
          {sortedIndustries.map((ind) => (
            <div key={ind.id}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-900">{ind.industry_name}</span>
                <span className="font-semibold text-gray-700">
                  ${formatAmount(ind.amount)}
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max((ind.amount / maxAmount) * 100, 3)}%`,
                    background: `linear-gradient(90deg, ${theme.industryFill}, ${theme.industryFill}66)`,
                  }}
                />
              </div>
            </div>
          ))}
          {sortedIndustries.length === 0 && (
            <p className="text-sm text-gray-400 italic">
              No industry data available yet.
            </p>
          )}
        </div>
      </div>

      {sortedDonors.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3">TOP DONORS</h3>
          <div className="space-y-2">
            {sortedDonors.map((d) => (
              <div
                key={d.id}
                className="flex justify-between p-2.5 bg-gray-50 rounded-lg"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{d.donor_name}</p>
                  {d.industry && (
                    <p className="text-xs text-gray-500">{d.industry}</p>
                  )}
                </div>
                <span className="text-sm font-semibold text-gray-700">
                  ${formatAmount(d.amount_total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return Math.round(n).toString();
}
