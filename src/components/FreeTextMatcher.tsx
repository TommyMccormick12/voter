'use client';

import { useState } from 'react';

interface Props {
  initialValue?: string;
  placeholder?: string;
  onSubmit?: (text: string) => void | Promise<void>;
  /** Whether the parent is in a submitting state (disables UI) */
  loading?: boolean;
}

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

/**
 * Free-text matcher textarea + submit. Validates min/max length.
 * Parent handles the actual /api/match call.
 */
export function FreeTextMatcher({
  initialValue = '',
  placeholder = "e.g. I want lower taxes for working families and someone serious about the border, but who isn't going to gut Social Security or Medicare for older folks like my mom.",
  onSubmit,
  loading = false,
}: Props) {
  const [text, setText] = useState(initialValue);
  const [error, setError] = useState('');

  const trimmed = text.trim();
  const tooShort = trimmed.length < MIN_LENGTH;

  const handleSubmit = async () => {
    if (tooShort) {
      setError(`Tell us a bit more — at least ${MIN_LENGTH} characters.`);
      return;
    }
    setError('');
    await onSubmit?.(trimmed);
  };

  return (
    <div>
      <label htmlFor="match-textarea" className="sr-only">
        Tell us in your own words
      </label>
      <textarea
        id="match-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
        placeholder={placeholder}
        maxLength={MAX_LENGTH}
        rows={6}
        disabled={loading}
        aria-describedby={error ? 'match-error' : 'match-help'}
        className="w-full border border-gray-300 rounded-xl p-4 lg:p-5 text-sm lg:text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 mb-2"
      />

      <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
        <span id="match-help">
          No personal info. Stays anonymous. Used only to find your match.
        </span>
        <span aria-live="polite">
          {trimmed.length}/{MAX_LENGTH}
        </span>
      </div>

      {error && (
        <p id="match-error" role="alert" className="text-red-500 text-sm mb-3">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || tooShort}
        className="w-full bg-blue-600 text-white text-base lg:text-lg font-medium py-3.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            <span>Matching...</span>
          </>
        ) : (
          <>
            <span>Find my match</span>
            <span className="text-blue-200 text-sm">· takes ~2s</span>
          </>
        )}
      </button>
    </div>
  );
}
