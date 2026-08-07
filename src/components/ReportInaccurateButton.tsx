'use client';

// "Report inaccurate" button shown in the candidate detail footer.
// Opens a modal with a small form; submits to POST /api/report.
//
// Pre-fills stance_id / cited_bill_id when the user clicked from a
// specific stance card (Phase 2D-quat §19.4).

import { useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Textarea } from './ui/Textarea';
import { TextInput } from './ui/TextInput';

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
  // Validation failure (client-side, per-field) is tracked separately from
  // server save failure (`state.kind === 'error'`) — frontend-standards:
  // "separate validation failure from server save failure."
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 20) {
      setDescriptionError('Description must be at least 20 characters.');
      descriptionRef.current?.focus();
      return;
    }
    setDescriptionError(null);
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
    setDescriptionError(null);
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
                <Button onClick={reset}>Done</Button>
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

                <Select
                  id="report-category"
                  label="What's wrong?"
                  containerClassName="mb-4"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />

                <Textarea
                  ref={descriptionRef}
                  id="report-description"
                  label="Details"
                  hint="Min 20 characters. Include a source link if you have one."
                  containerClassName="mb-1"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (descriptionError) setDescriptionError(null);
                  }}
                  rows={4}
                  minLength={20}
                  maxLength={2000}
                  showCount
                  placeholder="What's incorrect, and what's the correct info?"
                  required
                  error={descriptionError ?? undefined}
                />

                <TextInput
                  id="report-email"
                  label="Email"
                  hint="Optional — leave blank to stay anonymous."
                  containerClassName="mb-5 mt-4"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />

                {state.kind === 'error' && (
                  <p role="alert" className="text-sm text-status-error mb-4 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
                    {state.message}
                  </p>
                )}

                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="ghost" onClick={reset}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={state.kind === 'submitting'}
                    disabled={description.trim().length < 20}
                  >
                    {state.kind === 'submitting' ? 'Submitting…' : 'Submit report'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
