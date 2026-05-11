import { NextResponse, type NextRequest } from 'next/server';
import { getRacesForZip, getRace } from '@/lib/data/races';
import {
  getCandidatesForRace,
  getCandidateSamplesForRaces,
} from '@/lib/data/candidates';

/**
 * GET /api/candidates?zip=NNNNN
 * GET /api/candidates?race_id=...
 *
 * Returns races with candidates + top_stances. Used by client components
 * that need to refresh data without a full page reload.
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
    const race = await getRace(raceId);
    if (!race) {
      return NextResponse.json({ ok: false, error: 'race_not_found' }, { status: 404 });
    }
    const candidates = await getCandidatesForRace(raceId);
    return NextResponse.json({ ok: true, race, candidates });
  }

  if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_zip' },
      { status: 400 }
    );
  }

  const races = await getRacesForZip(zip);
  const samples = await getCandidateSamplesForRaces(races.map((r) => r.id));
  const racesWithCounts = races.map((r) => ({
    ...r,
    candidate_count: samples[r.id]?.count ?? 0,
  }));

  return NextResponse.json({ ok: true, zip, races: racesWithCounts });
}
