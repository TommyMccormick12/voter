import type { CandidateStatement } from '@/types/database';

interface Props {
  statements: CandidateStatement[];
}

export function StatementTimeline({ statements }: Props) {
  if (statements.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-500 mb-1">No public statements captured yet</p>
        <p className="text-xs text-gray-400">
          We pull from news, op-eds, debate transcripts, and campaign press releases.
        </p>
      </div>
    );
  }

  const sorted = [...statements].sort((a, b) => {
    const aTime = a.statement_date ? new Date(a.statement_date).getTime() : 0;
    const bTime = b.statement_date ? new Date(b.statement_date).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div className="space-y-4">
      {sorted.map((s) => (
        <div
          key={s.id}
          className="border border-gray-200 rounded-xl p-4 bg-white"
        >
          <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
            {s.context && (
              <span className="bg-gray-100 px-2 py-0.5 rounded font-medium">
                {contextLabel(s.context)}
              </span>
            )}
            {s.statement_date && (
              <span>{formatDate(s.statement_date)}</span>
            )}
          </div>
          <blockquote className="text-sm text-gray-900 leading-relaxed border-l-2 border-gray-200 pl-3 italic">
            &ldquo;{s.statement_text}&rdquo;
          </blockquote>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {s.issue_slugs.map((slug) => (
              <span
                key={slug}
                className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[11px] font-medium"
              >
                {slug}
              </span>
            ))}
            {s.source_url && (
              <a
                href={s.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-blue-600 font-medium hover:text-blue-700"
              >
                Source →
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function contextLabel(ctx: string): string {
  const map: Record<string, string> = {
    town_hall: 'Town hall',
    tv_debate: 'TV debate',
    op_ed: 'Op-ed',
    tweet: 'Social',
    press_release: 'Press release',
    interview: 'Interview',
    speech: 'Speech',
    campaign_video: 'Campaign video',
  };
  return map[ctx] ?? ctx;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
