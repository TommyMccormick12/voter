'use client';

// "Report inaccurate" button shown in the candidate detail footer.
// Opens a modal with a small form; submits to POST /api/report.
//
// Pre-fills stance_id / cited_bill_id when the user clicked from a
// specific stance card (Phase 2D-quat §19.4).

import { useState } from 'react';

interface Props {
  candidateId: string;
  candidateName: string;
  /** Optional pre-fill if the report was triggered from a specific stance. */
  stanceId?: string;
  /** Optional pre-fill if the report contests a track-record citation. */
  citedBillId?: string;
}

type Category = 'factual_error' | 'wrong_attribution' | 'outdated' | 'other';
type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; reportId: string }
  | { kind: 'error'; message: string };

const CATEGORY_LABELS: Record<Category, string> = {
  factual_error: 'Factual error',
  wrong_attribution: 'Wrong attribution (this isn\'t their position)',
  outdated: 'Outdated — they\'ve changed their position',
  other: 'Something else',
};

export function ReportInaccurateButton({
  candidateId,
  candidateName,
  stanceId,
  citedBillId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('factual_error');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 20) {
      setState({
        kind: 'error',
        message: 'Description must be at least 20 characters.',
      });
      return;
    }
    setState({ kind: 'submitting' });
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidateId,
          stance_id: stanceId,
          cited_bill_id: citedBillId,
          category,
          description: description.trim(),
          reporter_email: email.trim() ? email.trim() : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState({
          kind: 'error',
          message:
            json.error === 'rate_limited'
              ? 'Too many reports. Please wait a few minutes.'
              : json.error === 'invalid_payload'
                ? 'Some fields are invalid. Check the form.'
                : `Submission failed: ${json.error ?? 'unknown'}`,
        });
        return;
      }
      setState({ kind: 'success', reportId: json.report_id });
    } catch {
      setState({
        kind: 'error',
        message: 'Network error. Try again in a moment.',
      });
    }
  }

  function reset() {
    setOpen(false);
    setCategory('factual_error');
    setDescription('');
    setEmail('');
    setState({ kind: 'idle' });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
      >
        Report inaccurate
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            // Click backdrop = close. Don't close when clicking the modal itself.
            if (e.target === e.currentTarget) reset();
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-labelledby="report-title"
          >
            {state.kind === 'success' ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">✓</div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  Report submitted
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  Thanks for flagging this. We&apos;ll review it and update the
                  scorecard if needed.
                </p>
                <p className="text-[10px] font-mono text-gray-400 mb-6">
                  Reference: {state.reportId}
                </p>
                <button
                  type="button"
                  onClick={reset}
                  className="bg-gray-900 text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-gray-800"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <h2 id="report-title" className="text-xl font-bold text-gray-900 mb-1">
                  Report inaccurate content
                </h2>
                <p className="text-sm text-gray-500 mb-5">
                  About {candidateName}
                  {stanceId ? <span className="text-gray-400"> · stance: {stanceId}</span> : null}
                  {citedBillId ? <span className="text-gray-400"> · bill: {citedBillId}</span> : null}
                </p>

                <label className="block mb-4">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                    What&apos;s wrong?
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>

                <label className="block mb-4">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                    Details <span className="font-normal text-gray-400">(min 20 chars)</span>
                  </span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    minLength={20}
                    maxLength={2000}
                    placeholder="What's incorrect, and what's the correct info? Include a source link if you have one."
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y"
                    required
                  />
                  <span className="text-[10px] text-gray-400 mt-1 block">
                    {description.length} / 2000
                  </span>
                </label>

                <label className="block mb-5">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                    Email <span className="font-normal text-gray-400">(optional — leave blank to stay anonymous)</span>
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </label>

                {state.kind === 'error' && (
                  <p className="text-sm text-red-600 mb-4 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
                    {state.message}
                  </p>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={reset}
                    className="text-sm font-medium text-gray-600 px-4 py-2.5 rounded-lg hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={state.kind === 'submitting' || description.trim().length < 20}
                    className="bg-gray-900 text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {state.kind === 'submitting' ? 'Submitting…' : 'Submit report'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
