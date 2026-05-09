interface Props {
  score: number; // 0-100
  size?: 'sm' | 'md' | 'lg';
  /** Color class — pass theme accent class (e.g. theme.text) for party theming */
  colorClass?: string;
}

/**
 * Match score badge — shows a percentage with optional party-color theming.
 * Used in MatchResults page (large for top match, smaller for ranked list).
 */
export function MatchScoreBadge({ score, size = 'md', colorClass = 'text-blue-600' }: Props) {
  const sizing = {
    sm: { num: 'text-xl', label: 'text-[10px]' },
    md: { num: 'text-3xl', label: 'text-xs' },
    lg: { num: 'text-5xl', label: 'text-xs' },
  }[size];

  const labelSpan = score > 60
    ? 'closest alignment'
    : score > 35
      ? 'partial alignment'
      : 'limited alignment';

  return (
    <div className="text-right" aria-label={`Match score: ${score}%`}>
      <div className={`font-bold leading-none ${sizing.num} ${colorClass}`}>
        {score}
        <span className={size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-lg' : 'text-sm'}>
          %
        </span>
      </div>
      {size !== 'sm' && (
        <p className={`text-gray-600 mt-1 ${sizing.label}`}>{labelSpan}</p>
      )}
    </div>
  );
}
