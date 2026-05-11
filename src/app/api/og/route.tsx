import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getRace } from '@/lib/data/races';
import { getCandidatesForRace } from '@/lib/data/candidates';

// nodejs runtime: data/* helpers do a static JSON import of
// zip-districts.json which Next handles fine on edge, but using nodejs
// avoids any edge-bundle weirdness with @supabase/supabase-js and keeps
// this consistent with /api/match (also nodejs).
export const runtime = 'nodejs';

// Satori (Next OG) renders these as inline-CSS HTML. Hard rules:
//   - every element with children needs display:flex
//   - no rgb() inside gradients (hex only)
//   - children that resolve to multiple nodes (e.g. `{n}.`) must use a template
//     literal so it stays a single string child

interface PartyPalette {
  /** Hero strip gradient (left band) */
  bandFrom: string;
  bandTo: string;
  /** Accent text color */
  accent: string;
  /** Avatar gradient */
  avatarFrom: string;
  avatarTo: string;
  label: string;
}

const PARTIES: Record<'R' | 'D' | 'I', PartyPalette> = {
  R: {
    bandFrom: '#fef2f2',
    bandTo: '#fecaca',
    accent: '#991b1b',
    avatarFrom: '#f87171',
    avatarTo: '#dc2626',
    label: 'Republican',
  },
  D: {
    bandFrom: '#eff6ff',
    bandTo: '#bfdbfe',
    accent: '#1e40af',
    avatarFrom: '#60a5fa',
    avatarTo: '#2563eb',
    label: 'Democrat',
  },
  I: {
    bandFrom: '#f5f3ff',
    bandTo: '#ddd6fe',
    accent: '#5b21b6',
    avatarFrom: '#a78bfa',
    avatarTo: '#7c3aed',
    label: 'Independent',
  },
};

function pickParty(p: string | null | undefined): PartyPalette {
  if (!p) return PARTIES.I;
  const k = p.toUpperCase().charAt(0);
  if (k === 'R') return PARTIES.R;
  if (k === 'D') return PARTIES.D;
  return PARTIES.I;
}

function partyInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}

function clampScore(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const raceId = searchParams.get('race');
  const slug = searchParams.get('c');
  const score = clampScore(searchParams.get('s'));

  const race = raceId ? await getRace(raceId) : null;
  // Cross-validate candidate belongs to the named race (mirrors /share/page.tsx).
  const candidate =
    raceId && slug
      ? (await getCandidatesForRace(raceId)).find((c) => c.slug === slug) ?? null
      : null;

  // Generic invite — no params, or unknown race/candidate
  if (!race || !candidate) {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            backgroundColor: 'white',
            fontFamily: 'sans-serif',
            padding: '60px',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 64,
              fontWeight: 700,
              color: '#0f172a',
              marginBottom: '16px',
            }}
          >
            Find your match
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 30,
              color: '#475569',
              textAlign: 'center',
            }}
          >
            Compare 2026 primary candidates on stances, donors, and voting record.
          </div>
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              bottom: '40px',
              right: '60px',
              fontSize: 28,
              fontWeight: 700,
              color: '#2563eb',
            }}
          >
            voter
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    );
  }

  const palette = pickParty(candidate.primary_party);
  const seat = race.district ? `${race.state}-${race.district}` : race.state;
  const partyTag =
    race.primary_party === 'R'
      ? '(R)'
      : race.primary_party === 'D'
        ? '(D)'
        : '';
  const raceLabel = `${race.office} ${seat}${partyTag ? ` ${partyTag}` : ''}`;
  const candidateRole = candidate.incumbent ? 'Incumbent' : 'Challenger';

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          backgroundColor: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Left band — party-themed hero stripe */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            width: '420px',
            height: '100%',
            backgroundImage: `linear-gradient(135deg, ${palette.bandFrom}, ${palette.bandTo})`,
            padding: '50px',
          }}
        >
          {/* Avatar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '160px',
              height: '160px',
              borderRadius: '9999px',
              backgroundImage: `linear-gradient(135deg, ${palette.avatarFrom}, ${palette.avatarTo})`,
              color: 'white',
              fontSize: 64,
              fontWeight: 700,
              marginBottom: '40px',
            }}
          >
            {partyInitials(candidate.name)}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              color: palette.accent,
              marginBottom: '8px',
            }}
          >
            Top match
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 44,
              fontWeight: 700,
              color: '#0f172a',
              lineHeight: 1.1,
              marginBottom: '8px',
            }}
          >
            {candidate.name}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              color: '#334155',
            }}
          >
            {`${palette.label} · ${candidateRole}`}
          </div>
        </div>

        {/* Right pane — race + score + footer */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            height: '100%',
            padding: '60px',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 22,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '2px',
                color: '#64748b',
                marginBottom: '14px',
              }}
            >
              2026 Primary
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 48,
                fontWeight: 700,
                color: '#0f172a',
                lineHeight: 1.1,
                marginBottom: '40px',
              }}
            >
              {raceLabel}
            </div>

            {score != null && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontSize: 22,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '2px',
                    color: '#64748b',
                    marginBottom: '8px',
                  }}
                >
                  Match score
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    color: palette.accent,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 160,
                      fontWeight: 800,
                      lineHeight: 1,
                    }}
                  >
                    {String(score)}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 56,
                      fontWeight: 700,
                      marginLeft: '8px',
                    }}
                  >
                    %
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer: branding */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderTop: '2px solid #e2e8f0',
              paddingTop: '20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 22,
                color: '#475569',
              }}
            >
              Find your own match in 60 seconds
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 28,
                fontWeight: 700,
                color: '#2563eb',
              }}
            >
              voter
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
