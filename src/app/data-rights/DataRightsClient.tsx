'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ConsentState } from '@/types/database';

interface DataRightsResponse {
  ok: true;
  session_id_pseudonym: string;
  current_consent: ConsentState | null;
  visits: Array<{
    visit_started_at: string;
    visit_ended_at: string | null;
    pages_viewed: number;
    ip_country: string | null;
    ip_region: string | null;
  }>;
  consent_history: Array<{
    consent_type: string;
    granted: boolean;
    granted_at: string;
  }>;
}

export function DataRightsClient() {
  const [data, setData] = useState<DataRightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/data-rights');
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voter-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!confirm('Delete all your data? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/data-rights', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDeleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  };

  const handleOptOutSale = async () => {
    if (!data?.current_consent) return;
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analytics: data.current_consent.analytics,
          data_sale: false,
          marketing: data.current_consent.marketing,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // refresh
      const reload = await fetch('/api/data-rights');
      const body = await reload.json();
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  if (loading) {
    return <p className="text-gray-500">Loading your data…</p>;
  }

  if (deleted) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-bold text-emerald-900 mb-2">Data deleted</h2>
        <p className="text-sm text-emerald-800 mb-4">
          All data linked to your session has been purged. Your cookies have been
          cleared. You can close this tab now.
        </p>
        <Link
          href="/"
          className="inline-block bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700"
        >
          Go to homepage
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-900">Error: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <Section title="Your session pseudonym">
        <p className="text-sm text-gray-700 mb-2">
          We identify you only by an opaque session token, never by name or
          email. Short prefix:
        </p>
        <code className="bg-gray-100 px-3 py-1 rounded text-sm font-mono">
          {data.session_id_pseudonym}
        </code>
      </Section>

      <Section title="Your current consent">
        {data.current_consent ? (
          <ul className="text-sm space-y-1.5">
            <ConsentItem label="Functional" enabled={true} note="(always on)" />
            <ConsentItem label="Analytics" enabled={data.current_consent.analytics} />
            <ConsentItem
              label="Sale of aggregated data"
              enabled={data.current_consent.data_sale}
              actionLabel={data.current_consent.data_sale ? 'Opt out of sale' : null}
              onAction={handleOptOutSale}
            />
            <ConsentItem label="Marketing" enabled={data.current_consent.marketing} />
          </ul>
        ) : (
          <p className="text-sm text-gray-700">
            No consent recorded yet. Default: functional only.
          </p>
        )}
      </Section>

      <Section title={`Visits (${data.visits.length})`}>
        {data.visits.length === 0 ? (
          <p className="text-sm text-gray-500">No visit data recorded.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {data.visits.map((v, i) => (
              <li key={i} className="text-gray-700">
                {new Date(v.visit_started_at).toLocaleString()} ·{' '}
                {v.pages_viewed} page{v.pages_viewed === 1 ? '' : 's'}
                {v.ip_region && v.ip_country && (
                  <> · {v.ip_region}, {v.ip_country}</>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Consent history (${data.consent_history.length})`}>
        {data.consent_history.length === 0 ? (
          <p className="text-sm text-gray-500">No consent changes recorded yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {data.consent_history.map((c, i) => (
              <li key={i} className="text-gray-700">
                {new Date(c.granted_at).toLocaleString()} ·{' '}
                <span className="font-medium">{c.consent_type}</span>:{' '}
                {c.granted ? 'granted' : 'revoked'}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="border-t border-gray-200 pt-6 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleExport}
          className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700"
        >
          Download my data (JSON)
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="bg-red-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete all my data'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-5 bg-white">
      <h2 className="text-sm font-bold text-gray-900 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function ConsentItem({
  label,
  enabled,
  note,
  actionLabel,
  onAction,
}: {
  label: string;
  enabled: boolean;
  note?: string;
  actionLabel?: string | null;
  onAction?: () => void;
}) {
  return (
    <li className="flex items-center gap-2">
      <span className={enabled ? 'text-emerald-600' : 'text-gray-400'} aria-hidden="true">
        {enabled ? '✓' : '✗'}
      </span>
      <span className="text-gray-900">
        {label} {note && <span className="text-gray-500">{note}</span>}
      </span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="ml-auto text-xs text-blue-600 hover:text-blue-700 underline"
        >
          {actionLabel}
        </button>
      )}
    </li>
  );
}
