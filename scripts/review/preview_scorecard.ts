// Generate a self-contained HTML preview of a candidate's scorecard +
// detail view from live Supabase data. Inlines Tailwind via CDN so the
// file opens cleanly in any browser without the dev server.
//
// Used during the review pass before activating a candidate: render the
// preview, open it in a browser, eyeball whether the stances, donor
// industries, voting record, and track-record annotations look right.
//
// Usage:
//   npm run review:preview -- --slug maxwell-alejandro-frost \
//     --output ./tmp/frost-preview.html

import '../_env';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Minimal row-shape types used by the renderer below. The Supabase rows
// have many more fields, but these are the only ones the HTML preview
// references. Keeps the script free of the full `@/types/database` import
// (no need to track schema drift here).
type StanceRow = {
  issue_slug: string;
  stance: string;
  summary: string;
  confidence: number;
  source_excerpt?: string;
  track_record_note?: string;
  track_record_citations?: string[];
};
type IndustryRow = {
  industry_name: string;
  amount: number;
  rank: number;
  cycle?: number;
};
type VoteRow = {
  bill_id: string;
  bill_title: string;
  vote: string;
  vote_date: string | null;
  issue_slugs: string[] | null;
};
import { createClient } from '@supabase/supabase-js';

interface Args {
  slug: string;
  output: string;
}
function parseArgs(): Args {
  const args = process.argv.slice(2);
  let slug = '';
  let output = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug') slug = args[++i] ?? '';
    else if (args[i] === '--output') output = args[++i] ?? '';
  }
  if (!slug || !output) {
    console.error('Usage: --slug <candidate-slug> --output <path>');
    process.exit(1);
  }
  return { slug, output };
}

const PARTY_THEMES = {
  R: { bg: 'bg-red-50', border: 'border-red-300', accent: 'bg-red-600 text-white', text: 'text-red-700', gradient: 'from-red-100 to-red-300', label: 'Republican' },
  D: { bg: 'bg-blue-50', border: 'border-blue-300', accent: 'bg-blue-600 text-white', text: 'text-blue-700', gradient: 'from-blue-100 to-blue-300', label: 'Democratic' },
  I: { bg: 'bg-violet-50', border: 'border-violet-300', accent: 'bg-violet-600 text-white', text: 'text-violet-700', gradient: 'from-violet-100 to-violet-300', label: 'Independent' },
};

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

async function main() {
  const { slug, output } = parseArgs();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: c, error } = await sb
    .from('candidates')
    .select('*, candidate_top_industries(*), candidate_voting_record(*), candidate_donors(*), candidate_statements(*), candidate_positions(*)')
    .eq('slug', slug)
    .single();
  if (error || !c) {
    console.error('failed:', error?.message);
    process.exit(1);
  }
  const { data: race } = await sb.from('races').select('*').eq('id', c.race_id).single();

  const theme = PARTY_THEMES[(c.primary_party as 'R'|'D'|'I') ?? 'I'] ?? PARTY_THEMES.I;
  const initials = c.name.split(/\s+/).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase();

  const industries = (c.candidate_top_industries ?? []).sort(
    (a: { rank: number }, b: { rank: number }) => a.rank - b.rank,
  );
  const votes = (c.candidate_voting_record ?? []).sort(
    (a: { vote_date: string | null }, b: { vote_date: string | null }) =>
      (b.vote_date ?? '').localeCompare(a.vote_date ?? ''),
  );
  const stances = c.top_stances ?? [];
  const stanceLabel: Record<string, string> = {
    strongly_support: 'Strongly supports',
    support: 'Supports',
    neutral: 'Neutral',
    oppose: 'Opposes',
    strongly_oppose: 'Strongly opposes',
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(c.name)} — voter scorecard preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .grid-divider > * + * { border-top: 1px dashed #e5e7eb; padding-top: 2rem; margin-top: 2rem; }
</style>
</head>
<body class="bg-gray-50 min-h-screen">

<div class="max-w-5xl mx-auto px-4 py-8">
  <!-- Preview banner -->
  <div class="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 mb-6 text-sm">
    <strong>Preview</strong> — this is a self-contained snapshot of <code>voter</code> candidate data captured for <strong>${esc(c.name)}</strong>.
    Real app rendering at <code>/candidate/${esc(c.slug)}</code> and <code>/scorecards/${esc(c.race_id)}</code>.
    Source: Supabase production DB, generated ${new Date().toISOString().slice(0,16)} UTC.
  </div>

  <!-- ============================================================ -->
  <!-- 1. CAROUSEL CARD (what users see in /scorecards/[raceId]) -->
  <!-- ============================================================ -->
  <h2 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">1. Carousel scorecard</h2>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">

    <div class="bg-white rounded-2xl border-2 ${theme.border} overflow-hidden shadow-md">
      <!-- Hero strip -->
      <div class="bg-gradient-to-br ${theme.gradient} p-5">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-full bg-white/40 border-2 border-white flex items-center justify-center text-2xl font-bold text-white shadow-md">
            ${esc(initials)}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[10px] font-bold ${theme.text} uppercase tracking-wide">${theme.label} Primary</p>
            <h3 class="text-lg font-bold text-gray-900 leading-tight truncate">${esc(c.name)}</h3>
            <p class="text-xs text-gray-700">
              ${c.incumbent ? 'Incumbent' : 'Challenger'} · ${esc(race?.office ?? '')} ${race?.district ? `· ${race.state}-${race.district}` : `· ${race?.state ?? ''}`}
            </p>
          </div>
        </div>
        <p class="mt-3 text-xs ${theme.text} font-semibold">
          $${(c.total_raised ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} raised this cycle
        </p>
      </div>

      <!-- Top 3 stances (carousel view shows top 3) -->
      <div class="p-5 space-y-3">
        <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider">Top stances</h4>
        ${stances.slice(0, 3).map((s: StanceRow) => `
          <div class="border-l-2 ${theme.border} pl-3">
            <p class="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              ${esc(s.issue_slug)}
              <span class="text-[10px] ${theme.accent} px-2 py-0.5 rounded-full">${esc(stanceLabel[s.stance] ?? s.stance)}</span>
              ${s.confidence ? `<span class="text-[10px] text-gray-400">conf ${s.confidence}/100</span>` : ''}
            </p>
            <p class="text-sm text-gray-800 mt-1 leading-snug">${esc(s.summary)}</p>
            ${s.track_record_note ? `
              <p class="text-xs ${s.track_record_note.match(/contradict|despite/i) ? 'text-amber-700' : 'text-emerald-700'} mt-1.5 italic">
                ${s.track_record_note.match(/contradict|despite/i) ? '⚠️' : '✓'} ${esc(s.track_record_note.slice(0, 180))}
              </p>` : ''}
          </div>
        `).join('')}

        <!-- Funded by -->
        ${industries.length > 0 ? `
          <div class="pt-3 border-t border-gray-100">
            <p class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Funded by — top 3 industries</p>
            <div class="flex flex-wrap gap-1.5">
              ${industries.slice(0, 3).map((i: IndustryRow) =>
                `<span class="text-[11px] bg-gray-100 text-gray-700 px-2 py-1 rounded-full">${esc(i.industry_name)}</span>`
              ).join('')}
            </div>
          </div>` : ''}

        <!-- CTAs -->
        <div class="flex gap-2 pt-3">
          <button class="flex-1 ${theme.accent} text-sm font-semibold py-2 rounded-lg">★ Save</button>
          <button class="flex-1 border ${theme.border} ${theme.text} text-sm font-semibold py-2 rounded-lg">Full record →</button>
        </div>
      </div>
    </div>

    <!-- Annotated breakdown of what the card shows -->
    <div class="text-sm text-gray-700 space-y-3 lg:px-4">
      <h3 class="text-base font-bold text-gray-900">What's on the card</h3>
      <p>The carousel scorecard surfaces the highest-signal data without overwhelming the user. Three layers:</p>
      <ul class="list-disc list-inside space-y-2 text-sm">
        <li><strong>Identity strip</strong> — party-themed gradient, initials, incumbent/challenger flag, total raised (FEC source of truth).</li>
        <li><strong>Top 3 stances</strong> — synthesized from Wikipedia "Political positions" via Haiku. Each carries a confidence score (0–100) and an optional <em>track-record note</em> that flags vote-vs-rhetoric alignment or contradiction. Track-record notes must cite real bill_ids from the voting record; the citation validator rejects fabrications.</li>
        <li><strong>Funded by</strong> — top 3 industries from itemized FEC contributions, Haiku-classified into 19 buckets.</li>
      </ul>
      <p class="text-xs text-gray-500 mt-3">The fourth+ stances live on the full detail page — tap "Full record →" to see them all.</p>
    </div>
  </div>

  <!-- ============================================================ -->
  <!-- 2. FULL DETAIL VIEW (what users see in /candidate/[slug]) -->
  <!-- ============================================================ -->
  <h2 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">2. Full candidate detail (/candidate/${esc(c.slug)})</h2>
  <div class="bg-white rounded-2xl border ${theme.border} shadow-md overflow-hidden">

    <!-- Hero -->
    <div class="bg-gradient-to-br ${theme.gradient} p-8">
      <div class="flex items-start gap-6">
        <div class="w-24 h-24 rounded-full bg-white/50 border-4 border-white flex items-center justify-center text-3xl font-bold text-white shadow-lg">
          ${esc(initials)}
        </div>
        <div class="flex-1">
          <p class="text-xs font-bold ${theme.text} uppercase tracking-wider">${theme.label} Primary · ${esc(race?.state ?? '')} ${race?.district ? race.district : ''}</p>
          <h1 class="text-3xl font-bold text-gray-900 mt-1">${esc(c.name)}</h1>
          <p class="text-sm text-gray-700 mt-2">
            ${c.incumbent ? 'Incumbent' : 'Challenger'} ·
            $${(c.total_raised ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} raised ·
            <a href="${esc(c.website ?? '#')}" class="underline">${esc(c.website ?? '')}</a>
          </p>
        </div>
      </div>
      <p class="text-sm text-gray-800 mt-5 leading-relaxed">${esc(c.bio ?? '')}</p>
    </div>

    <!-- Tab nav (static) -->
    <div class="border-b border-gray-200 px-8 flex gap-6 text-sm font-semibold">
      <button class="${theme.text} border-b-2 ${theme.border.replace('border-', 'border-b-')} py-3">Stances (${stances.length})</button>
      <button class="text-gray-500 py-3">Donors (${(c.candidate_donors ?? []).length})</button>
      <button class="text-gray-500 py-3">Industries (${industries.length})</button>
      <button class="text-gray-500 py-3">Voting record (${votes.length})</button>
      <button class="text-gray-500 py-3">Statements (${(c.candidate_statements ?? []).length})</button>
    </div>

    <div class="p-8 grid-divider">

      <!-- ALL STANCES -->
      <section>
        <h3 class="text-lg font-bold text-gray-900 mb-4">All stances · ${stances.length}</h3>
        <div class="space-y-4">
          ${stances.map((s: StanceRow) => `
            <div class="border ${theme.border} rounded-xl p-4 bg-white">
              <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h4 class="font-semibold text-gray-900 capitalize">${esc(s.issue_slug.replace('_', ' '))}</h4>
                <div class="flex items-center gap-2">
                  <span class="text-xs ${theme.accent} px-2 py-1 rounded-full font-bold">${esc(stanceLabel[s.stance] ?? s.stance)}</span>
                  <span class="text-xs text-gray-500">conf ${s.confidence}/100</span>
                </div>
              </div>
              <p class="text-sm text-gray-800 leading-relaxed">${esc(s.summary)}</p>
              ${s.source_excerpt ? `<p class="text-xs text-gray-500 italic mt-2 border-l-2 border-gray-200 pl-3">"${esc(s.source_excerpt)}"</p>` : ''}
              ${s.track_record_note ? `
                <div class="mt-3 ${s.track_record_note.match(/contradict|despite/i) ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} border rounded-lg px-3 py-2">
                  <p class="text-xs font-semibold ${s.track_record_note.match(/contradict|despite/i) ? 'text-amber-900' : 'text-emerald-900'} mb-1">
                    ${s.track_record_note.match(/contradict|despite/i) ? '⚠️ Track-record note' : '✓ Track-record alignment'}
                  </p>
                  <p class="text-xs ${s.track_record_note.match(/contradict|despite/i) ? 'text-amber-800' : 'text-emerald-800'}">${esc(s.track_record_note)}</p>
                  ${(s.track_record_citations ?? []).length > 0 ? `
                    <p class="text-[10px] mt-1 ${s.track_record_note.match(/contradict|despite/i) ? 'text-amber-700' : 'text-emerald-700'}">
                      Cites: ${(s.track_record_citations ?? []).map((cit: string) => `<code class="bg-white/60 px-1 rounded">${esc(cit)}</code>`).join(' · ')}
                    </p>` : ''}
                </div>` : ''}
            </div>
          `).join('')}
        </div>
      </section>

      <!-- TOP INDUSTRIES -->
      ${industries.length > 0 ? `
      <section>
        <h3 class="text-lg font-bold text-gray-900 mb-4">Top donor industries · ${industries.length}</h3>
        <p class="text-xs text-gray-500 mb-3">Source: FEC itemized contributions, cycle ${industries[0]?.cycle ?? 2026}. Haiku-classified into 19 buckets.</p>
        <div class="space-y-2">
          ${industries.map((i: IndustryRow) => {
            const max = industries[0].amount;
            const pct = Math.round((i.amount / max) * 100);
            return `
            <div class="flex items-center gap-3">
              <span class="text-xs font-bold text-gray-500 w-6">#${i.rank}</span>
              <span class="text-sm text-gray-800 flex-1">${esc(i.industry_name)}</span>
              <div class="flex-1 max-w-xs bg-gray-100 rounded-full h-2 overflow-hidden">
                <div class="${theme.accent.split(' ')[0]} h-2" style="width: ${pct}%"></div>
              </div>
              <span class="text-sm font-mono text-gray-700 w-24 text-right">$${Number(i.amount).toLocaleString()}</span>
            </div>`;
          }).join('')}
        </div>
      </section>` : ''}

      <!-- VOTING RECORD -->
      ${votes.length > 0 ? `
      <section>
        <h3 class="text-lg font-bold text-gray-900 mb-1">Recent voting record · top 8 of ${votes.length}</h3>
        <p class="text-xs text-gray-500 mb-3">Source: GovTrack (keyless, replaced sunset ProPublica Congress).</p>
        <div class="space-y-2">
          ${votes.slice(0, 8).map((v: VoteRow) => {
            const voteColor = v.vote === 'yea' ? 'bg-emerald-100 text-emerald-800' : v.vote === 'nay' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700';
            return `
            <div class="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
              <span class="text-[10px] font-bold uppercase ${voteColor} px-2 py-1 rounded">${esc(v.vote)}</span>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-gray-900"><code class="text-xs bg-gray-100 px-1 rounded mr-1">${esc(v.bill_id)}</code> ${esc((v.bill_title ?? '').slice(0, 100))}</p>
                <p class="text-[11px] text-gray-500">${esc(v.vote_date)}${(v.issue_slugs ?? []).length > 0 ? ' · ' + v.issue_slugs.map((s: string) => `<span class="inline-block bg-gray-50 px-1.5 rounded">${esc(s)}</span>`).join(' ') : ''}</p>
              </div>
            </div>`;
          }).join('')}
        </div>
      </section>` : `
      <section>
        <h3 class="text-lg font-bold text-gray-900 mb-1">Voting record</h3>
        <p class="text-sm text-gray-500">${c.incumbent ? 'No recent votes — left office mid-cycle.' : 'Challenger — no congressional voting history.'}</p>
      </section>`}

    </div>
  </div>

  <!-- ============================================================ -->
  <!-- 3. DATA INVENTORY (what's captured per candidate) -->
  <!-- ============================================================ -->
  <h2 class="text-xs font-bold text-gray-500 uppercase tracking-wider mt-12 mb-3">3. Data inventory (every field captured for this candidate)</h2>
  <div class="bg-white rounded-2xl border border-gray-200 p-6 text-sm">
    <table class="w-full text-left">
      <thead>
        <tr class="border-b border-gray-200">
          <th class="py-2 font-semibold text-gray-700">Field group</th>
          <th class="py-2 font-semibold text-gray-700">Source</th>
          <th class="py-2 font-semibold text-gray-700 text-right">Records</th>
        </tr>
      </thead>
      <tbody class="text-gray-700">
        <tr class="border-b border-gray-100"><td class="py-2">Identity (id, slug, name, party, district, incumbent flag)</td><td>FEC + Ballotpedia + Wikipedia</td><td class="text-right font-mono">1</td></tr>
        <tr class="border-b border-gray-100"><td class="py-2">Bio + website + photo</td><td>Wikipedia lead paragraph</td><td class="text-right font-mono">${c.bio ? '1' : '0'}</td></tr>
        <tr class="border-b border-gray-100"><td class="py-2">total_raised</td><td>FEC totals endpoint</td><td class="text-right font-mono">$${(c.total_raised ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>
        <tr class="border-b border-gray-100"><td class="py-2">top_stances (with confidence, track-record note, citations)</td><td>Haiku synthesis of platform + voting record</td><td class="text-right font-mono">${stances.length}</td></tr>
        <tr class="border-b border-gray-100"><td class="py-2">candidate_top_industries</td><td>FEC contributions → Haiku-classified buckets</td><td class="text-right font-mono">${industries.length}</td></tr>
        <tr class="border-b border-gray-100"><td class="py-2">candidate_donors (individual contributor names)</td><td>FEC Schedule A</td><td class="text-right font-mono">${(c.candidate_donors ?? []).length}</td></tr>
        <tr class="border-b border-gray-100"><td class="py-2">candidate_voting_record (last 50 votes per query cap)</td><td>GovTrack member votes</td><td class="text-right font-mono">${votes.length}</td></tr>
        <tr class="border-b border-gray-100"><td class="py-2">candidate_positions (per-issue stated platform)</td><td>Wikipedia/Ballotpedia/campaign-site → Haiku</td><td class="text-right font-mono">${(c.candidate_positions ?? []).length}</td></tr>
        <tr><td class="py-2">candidate_statements (press releases / news)</td><td>NewsAPI + campaign-site scraping (opt-in)</td><td class="text-right font-mono">${(c.candidate_statements ?? []).length}</td></tr>
      </tbody>
    </table>
  </div>
</div>

</body>
</html>
`;

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  console.log(`[preview] wrote ${output}`);
  console.log(`           open it in any browser — fully self-contained.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
