import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // Allowlist hosts for next/image remote sources. Required by Next.js —
    // any remote <Image src=...> URL must match one of these patterns or
    // the optimizer rejects it.
    //
    // bioguide.congress.gov hosts the official portrait of every current
    // and former member of Congress. URLs are stable and follow the pattern
    // /bioguide/photo/{FIRST_LETTER}/{BIOGUIDE_ID}.jpg. Public domain — US
    // government work, no attribution required.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'bioguide.congress.gov',
        pathname: '/bioguide/photo/**',
      },
    ],
  },
};

export default nextConfig;
