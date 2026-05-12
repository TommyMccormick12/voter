import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | voter',
};

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 lg:px-8 py-10 lg:py-14 prose-base">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Last updated: 2026-05-11
      </p>
      <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-6">
        Privacy Policy
      </h1>

      <div className="space-y-6 text-base text-gray-800 leading-relaxed">
        <Section title="The short version">
          <p>
            We collect anonymous engagement data tied only to a session token
            in your browser cookies. We don&apos;t ask for your name, phone
            number, or precise location. We may sell aggregated, district-level
            insights to researchers, polling firms, and newsrooms — but only
            with your explicit consent, and only in cohorts of 100+ users.
          </p>
          <p>
            One exception: if you submit a &ldquo;Report inaccurate&rdquo; form
            on a candidate&apos;s page and choose to include your email, we
            store it alongside the report so we can follow up. Email is
            optional; the form works without it. See{' '}
            <a href="#report-inaccurate" className="text-blue-600 underline">
              Report inaccurate
            </a>{' '}
            below.
          </p>
          <p>
            Manage your data choices anytime at{' '}
            <Link href="/data-rights" className="text-blue-600 underline">
              /data-rights
            </Link>
            .
          </p>
        </Section>

        <Section title="What we collect">
          <p className="font-semibold mb-1">Tier A — Functional (always on, strictly necessary)</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>Session token (anonymous random string, cookie)</li>
            <li>Zip code you enter (cookie, used to find races)</li>
            <li>CSRF protection tokens</li>
          </ul>
          <p className="font-semibold mb-1">Tier B — Analytics (consent_analytics opt-in)</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>Page views (which scorecards you view)</li>
            <li>Candidate interactions (saves, full-record views, dwell time)</li>
            <li>Funnel completion (race-picker → carousel → poll → free-text → results)</li>
            <li>Coarse device hints (mobile/desktop, browser family — never version)</li>
            <li>Coarse geo (country and state, derived from IP — IP itself never stored)</li>
            <li>UTM parameters and apex referrer domain (first-touch attribution)</li>
            <li>Multi-session counters (return visit count, days since first visit)</li>
          </ul>
          <p className="font-semibold mb-1">Tier C — Sale of aggregated data (consent_data_sale opt-in)</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>All of Tier B, plus your free-text submissions and quick-poll weights</li>
            <li>Aggregated to district level with minimum cohort size of 100</li>
            <li>Sold to vetted buyers (polling firms, academic researchers, newsrooms)</li>
          </ul>
        </Section>

        <Section title="What we never collect">
          <ul className="list-disc pl-5 space-y-1">
            <li>Your IP address (raw — we derive coarse geo and discard)</li>
            <li>Your user agent (we hash it and store the hash, never the raw string)</li>
            <li>
              Phone, name, address (we don&apos;t ask). Email only via the
              optional Report Inaccurate form — see below.
            </li>
            <li>Browser fingerprinting signals (canvas, audio, font enumeration, plugin list)</li>
            <li>Cross-site browsing history (no third-party cookies, no pixel partners)</li>
            <li>Precise geolocation (no GPS, no Geolocation API)</li>
          </ul>
        </Section>

        <Section title="Cookies we set">
          <ul className="list-disc pl-5 space-y-1">
            <li><code>voter_session</code> — anonymous session token (1 year)</li>
            <li><code>voter_consent</code> — your consent choices (1 year)</li>
            <li><code>voter_visitor_id</code> — return-visit detection, only after analytics opt-in (2 years)</li>
            <li><code>voter_utm</code> — first-touch attribution (90 days)</li>
            <li><code>voter_zip</code> — your zip code for race lookup (30 days)</li>
          </ul>
          <p className="mt-2">
            All cookies are first-party (set on our domain only) and use
            <code> SameSite=Lax</code>. We use no third-party cookies, ad-network
            beacons, or fingerprinting trackers.
          </p>
        </Section>

        <section id="report-inaccurate">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Report inaccurate (the only path that may collect email)
          </h2>
          <div className="space-y-2">
            <p>
              Each candidate page has a &ldquo;Report inaccurate&rdquo; button.
              If you spot a wrong stance attribution, an outdated quote, or a
              fabricated bill citation, you can flag it for manual review.
            </p>
            <p>
              The form asks for a category (factual error / wrong attribution /
              outdated / other), a description of what&apos;s wrong (required,
              20–2000 characters), and{' '}
              <strong>optionally</strong> your email address.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Email is optional.</strong> The form submits and the
                report is recorded whether or not you provide one.
              </li>
              <li>
                <strong>What we do with it:</strong> If you provided an email
                and the report is actionable, we may reach out for follow-up
                detail or to let you know the outcome.
              </li>
              <li>
                <strong>What we don&apos;t do with it:</strong> Never sold,
                never shared with third parties, never used for marketing or
                added to any mailing list. Not joined to your
                <code> voter_session</code> for cross-page tracking.
              </li>
              <li>
                <strong>Retention:</strong> Stored as long as the report stays
                in the review queue. Resolved/dismissed reports are kept for
                audit per the consent-log retention policy (24 months) and
                then purged with the report.
              </li>
              <li>
                <strong>Right to delete:</strong> Use{' '}
                <Link href="/data-rights" className="text-blue-600 underline">
                  /data-rights
                </Link>{' '}
                or email the maintainer to remove a report you filed.
              </li>
            </ul>
          </div>
        </section>

        <Section title="Your rights">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Right to know:</strong> Download everything we have about you as JSON at <Link href="/data-rights" className="text-blue-600 underline">/data-rights</Link>.</li>
            <li><strong>Right to delete:</strong> Purge all data linked to your session at <Link href="/data-rights" className="text-blue-600 underline">/data-rights</Link>.</li>
            <li><strong>Right to opt out of sale:</strong> Disable the &ldquo;Sale of aggregated data&rdquo; toggle anytime.</li>
            <li><strong>California (CCPA/CPRA):</strong> All of the above, plus the &ldquo;Do Not Sell My Personal Information&rdquo; control on the data-rights page.</li>
            <li><strong>Colorado, Connecticut, Virginia, Utah:</strong> Political opinion data is treated as sensitive — we require opt-in (not opt-out) for sale.</li>
          </ul>
        </Section>

        <Section title="Buyer due diligence">
          <p>
            Every commercial buyer of aggregated data signs an agreement
            forbidding (a) attempted re-identification, (b) resale of our data
            to third parties, and (c) any use for voter suppression, harassment,
            or influence operations. Buyers based in countries on US sanctions
            lists are blocked.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we materially change what we collect or sell, we will bump the
            consent version, which re-prompts you the next time you visit. The
            old consent record is preserved in our audit log for compliance.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions or complaints: open an issue on our public GitHub repo,
            or email the maintainer (link in the repo).
          </p>
        </Section>
      </div>

      <div className="mt-10 pt-6 border-t border-gray-200 flex gap-4 text-sm">
        <Link href="/data-rights" className="text-blue-600 underline">Manage your data</Link>
        <Link href="/terms" className="text-blue-600 underline">Terms of service</Link>
        <Link href="/" className="text-blue-600 underline">Home</Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-gray-900 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
