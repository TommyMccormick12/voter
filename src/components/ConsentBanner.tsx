'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readClientConsent } from '@/lib/consent-client';

type Mode = 'compact' | 'customize';

/**
 * First-visit consent banner. Bottom of viewport, non-modal.
 *
 * Flow:
 *   No cookie → banner shows
 *   "Accept all" → analytics + data_sale + marketing all true
 *   "Functional only" → all opt-ins false (functional is implied)
 *   "Customize" → expand granular toggles
 *
 * Per plan §14.5: per-state defaults are conservative everywhere
 * (data_sale starts false). User must explicitly opt in.
 */
export function ConsentBanner() {
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('compact');
  const [analytics, setAnalytics] = useState(true);
  const [dataSale, setDataSale] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from cookie
    setHasConsent(() => {
      const consent = readClientConsent();
      return consent !== null;
    });
  }, []);

  if (hasConsent === null) {
    // Server render and pre-hydration: render nothing to avoid mismatch.
    return null;
  }
  if (hasConsent === true) {
    // User has already chosen. Banner stays hidden until they revisit
    // /data-rights and revoke.
    return null;
  }

  const submit = async (next: { analytics: boolean; data_sale: boolean; marketing: boolean }) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHasConsent(true);
    } catch (err) {
      console.error('[consent] failed to submit', err);
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby="consent-banner-title"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-gray-200 bg-white shadow-2xl"
    >
      <div className="max-w-5xl mx-auto px-4 py-4 lg:py-5">
        {mode === 'compact' ? (
          <CompactView
            onAcceptAll={() => submit({ analytics: true, data_sale: true, marketing: true })}
            onFunctionalOnly={() => submit({ analytics: false, data_sale: false, marketing: false })}
            onCustomize={() => setMode('customize')}
            submitting={submitting}
          />
        ) : (
          <CustomizeView
            analytics={analytics}
            setAnalytics={setAnalytics}
            dataSale={dataSale}
            setDataSale={setDataSale}
            marketing={marketing}
            setMarketing={setMarketing}
            onSave={() => submit({ analytics, data_sale: dataSale, marketing })}
            onBack={() => setMode('compact')}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}

function CompactView({
  onAcceptAll,
  onFunctionalOnly,
  onCustomize,
  submitting,
}: {
  onAcceptAll: () => void;
  onFunctionalOnly: () => void;
  onCustomize: () => void;
  submitting: boolean;
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
      <div className="flex-1">
        <p id="consent-banner-title" className="text-sm font-semibold text-gray-900 mb-1">
          Your data choices
        </p>
        <p className="text-xs lg:text-sm text-gray-600 leading-relaxed">
          We collect anonymous engagement data (no email, no name, no precise
          location) to improve the site and to sell aggregated district-level
          insights to researchers. You can opt out of either or both.{' '}
          <Link href="/privacy" className="text-blue-600 underline">
            Privacy policy
          </Link>
          .
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onCustomize}
          disabled={submitting}
          className="text-sm font-medium text-gray-700 px-4 py-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"
        >
          Customize
        </button>
        <button
          type="button"
          onClick={onFunctionalOnly}
          disabled={submitting}
          className="text-sm font-medium text-gray-700 border border-gray-300 px-4 py-2 hover:bg-gray-50 rounded-lg disabled:opacity-50"
        >
          Functional only
        </button>
        <button
          type="button"
          onClick={onAcceptAll}
          disabled={submitting}
          className="text-sm font-semibold text-white bg-blue-600 px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Accept all
        </button>
      </div>
    </div>
  );
}

function CustomizeView({
  analytics,
  setAnalytics,
  dataSale,
  setDataSale,
  marketing,
  setMarketing,
  onSave,
  onBack,
  submitting,
}: {
  analytics: boolean;
  setAnalytics: (v: boolean) => void;
  dataSale: boolean;
  setDataSale: (v: boolean) => void;
  marketing: boolean;
  setMarketing: (v: boolean) => void;
  onSave: () => void;
  onBack: () => void;
  submitting: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">Customize your data choices</p>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          ← Back
        </button>
      </div>
      <div className="space-y-2.5 mb-4">
        <ToggleRow
          checked={true}
          disabled
          title="Functional"
          description="Required to use the site. Session token, zip lookup, CSRF protection."
        />
        <ToggleRow
          checked={analytics}
          onChange={setAnalytics}
          title="Analytics"
          description="Anonymous engagement (which scorecards you view, time per page, completion rates). Helps us improve the product."
        />
        <ToggleRow
          checked={dataSale}
          onChange={setDataSale}
          title="Sale of aggregated data"
          description="District-level issue priorities and sentiment trends sold to researchers, polling firms, and newsrooms. Aggregate-only — never individual-level. Min cohort size 100."
        />
        <ToggleRow
          checked={marketing}
          onChange={setMarketing}
          title="Marketing"
          description="(We don't currently send marketing. Reserved for future opt-in to civic engagement updates.)"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={submitting}
          className="text-sm font-semibold text-white bg-blue-600 px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Save choices
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  disabled = false,
  title,
  description,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  title: string;
  description: string;
}) {
  return (
    <label className={`flex items-start gap-3 p-2.5 border rounded-lg cursor-pointer ${disabled ? 'border-gray-200 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
        aria-describedby={`consent-${title.toLowerCase().replace(/\s/g, '-')}-desc`}
      />
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p
          id={`consent-${title.toLowerCase().replace(/\s/g, '-')}-desc`}
          className="text-xs text-gray-600 leading-snug mt-0.5"
        >
          {description}
        </p>
      </div>
    </label>
  );
}
