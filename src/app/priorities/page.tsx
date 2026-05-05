import { supabase } from '@/lib/supabase';
import { getAggregateByZip } from '@/lib/rankings';
import { RankingInterface } from '@/components/RankingInterface';
import type { Issue, AggregatedPriority } from '@/types/database';

interface Props {
  searchParams: Promise<{ zip?: string }>;
}

export default async function PrioritiesPage({ searchParams }: Props) {
  const { zip } = await searchParams;

  const { data: issues } = await supabase
    .from('issues')
    .select('id, name, slug, category')
    .eq('active', true)
    .order('name');

  let aggregates: AggregatedPriority[] = [];
  if (zip) {
    aggregates = await getAggregateByZip(zip);
  }

  return (
    <div className="min-h-screen bg-white px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          What matters most to you?
        </h1>
        <p className="text-gray-600 mb-8">
          Rank the issues by how important they are to your vote. See how your
          priorities compare to your community.
        </p>

        <RankingInterface
          issues={(issues as Pick<Issue, 'id' | 'name' | 'slug' | 'category'>[]) || []}
          zip={zip || ''}
          communityData={aggregates}
        />
      </div>
    </div>
  );
}
