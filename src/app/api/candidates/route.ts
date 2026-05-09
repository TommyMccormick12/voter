import { NextResponse, type NextRequest } from 'next/server';
import {
  getMockRacesForZip,
  getMockRace,
  getMockCandidatesForRace,
} from '@/lib/mock-data';

/**
 * GET /api/candidates?zip=NNNNN
 * GET /api/candidates?race_id=...
 *
 * Returns races with candidates + top_stances. Used by client components
 * that need to refresh data without a full page reload.
 *
 * TODO (Chunk 6): swap mock data calls for Supabase queries:
 *   SELECT r.*, c.* FROM races r
 *   JOIN candidates c ON c.race_id = r.id
 *   WHERE r.election_type = 'primary'
 *     AND r.election_date >= now()
 *     AND r.id IN (zip_to_district lookup)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const zip = searchParams.get('zip')?.trim();
  const raceId = searchParams.get('race_id')?.trim();

  if (!zip && !raceId) {
    return NextResponse.json(
      { ok: false, error: 'missing_query', message: 'Provide ?zip= or ?race_id=' },
      { status: 400 }
    );
  }

  if (raceId) {
    const race = getMockRace(raceId);
    if (!race) {
      return NextResponse.json({ ok: false, error: 'race_not_found' }, { status: 404 });
    }
    const candidates = getMockCandidatesForRace(raceId);
    return NextResponse.json({ ok: true, race, candidates });
  }

  if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_zip' },
      { status: 400 }
    );
  }

  const races = getMockRacesForZip(zip);
  const racesWithCounts = races.map((r) => ({
    ...r,
    candidate_count: getMockCandidatesForRace(r.id).length,
  }));

  return NextResponse.json({ ok: true, zip, races: racesWithCounts });
}
