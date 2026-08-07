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
    const raceResult = await getRace(raceId);
    if (!raceResult.ok) {
      return NextResponse.json({ ok: false, error: 'data_unavailable' }, { status: 503 });
    }
    if (!raceResult.data) {
      return NextResponse.json({ ok: false, error: 'race_not_found' }, { status: 404 });
    }
    const candidatesResult = await getCandidatesForRace(raceId);
    if (!candidatesResult.ok) {
      return NextResponse.json({ ok: false, error: 'data_unavailable' }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      race: raceResult.data,
      candidates: candidatesResult.data,
    });
  }

  if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_zip' },
      { status: 400 }
    );
  }

  const racesResult = await getRacesForZip(zip);
  if (!racesResult.ok) {
    return NextResponse.json({ ok: false, error: 'data_unavailable' }, { status: 503 });
  }
  const races = racesResult.data;
  const samplesResult = await getCandidateSamplesForRaces(races.map((r) => r.id));
  if (!samplesResult.ok) {
    return NextResponse.json({ ok: false, error: 'data_unavailable' }, { status: 503 });
  }
  const racesWithCounts = races.map((r) => ({
    ...r,
    candidate_count: samplesResult.data[r.id]?.count ?? 0,
  }));

  return NextResponse.json({ ok: true, zip, races: racesWithCounts });
}
