export const ISSUE_NAMES: Record<string, string> = {
  economy: 'Economy & Jobs',
  healthcare: 'Healthcare',
  immigration: 'Immigration',
  climate: 'Climate & Energy',
  education: 'Education',
  guns: 'Gun Policy',
  criminal_justice: 'Criminal Justice',
  foreign_policy: 'Foreign Policy',
  taxes: 'Taxes',
  housing: 'Housing',
};

export function getIssueName(slug: string): string {
  return ISSUE_NAMES[slug] || slug;
}
