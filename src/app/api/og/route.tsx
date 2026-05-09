import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getIssueName } from '@/lib/issues';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const rankingsParam = searchParams.get('r') || '';
  const zip = searchParams.get('zip') || '';
  const percentile = searchParams.get('p');

  const rankings = rankingsParam.split(',').filter(Boolean).slice(0, 5);

  // Generic card if no rankings provided
  if (rankings.length === 0) {
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
              fontSize: 64,
              fontWeight: 700,
              color: '#1a1a1a',
              marginBottom: '24px',
            }}
          >
            Rank your priorities
          </div>
          <div
            style={{
              fontSize: 32,
              color: '#666666',
            }}
          >
            See how your community compares
          </div>
          <div
            style={{
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
      { width: 1200, height: 630 }
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '60px',
          backgroundColor: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '40px',
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: '#1a1a1a',
            }}
          >
            My Priorities
          </div>
          {zip && (
            <div
              style={{
                display: 'flex',
                backgroundColor: '#eff6ff',
                color: '#2563eb',
                fontSize: 24,
                fontWeight: 600,
                padding: '8px 20px',
                borderRadius: '9999px',
              }}
            >
              {zip}
            </div>
          )}
        </div>

        {/* Rankings list */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            flex: 1,
          }}
        >
          {rankings.map((slug, index) => (
            <div
              key={slug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 36,
                  fontWeight: 700,
                  color: '#2563eb',
                  width: '50px',
                }}
              >
                {`${index + 1}.`}
              </div>
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 500,
                  color: '#1a1a1a',
                }}
              >
                {getIssueName(slug)}
              </div>
            </div>
          ))}
        </div>

        {/* Separator */}
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '2px',
            backgroundColor: '#e5e7eb',
            marginTop: '20px',
            marginBottom: '20px',
          }}
        />

        {/* Comparison line + footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 24,
              color: '#2563eb',
            }}
          >
            {percentile
              ? `${percentile}% of your neighbors agree on #1`
              : ''}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#2563eb',
            }}
          >
            voter
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
