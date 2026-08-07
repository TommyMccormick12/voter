// Shared textarea primitive (T18, Spec D1 / frontend-standards forms
// rules): visible label, error associated to the field via aria-describedby
// + aria-invalid, optional character-count hint.

import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> {
  id: string;
  label: string;
  /** When set with maxLength, shows a live "N / max" counter instead of `hint`. */
  showCount?: boolean;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

/** Forwards its ref to the <textarea> so callers can move focus to it after
 * a failed submit (frontend-standards: "move focus to the first invalid
 * field"). */
export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  {
    id,
    label,
    hint,
    error,
    showCount,
    maxLength,
    value,
    containerClassName = '',
    required,
    ...rest
  },
  ref
) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const currentLength = typeof value === 'string' ? value.length : 0;

  return (
    <div className={containerClassName}>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
        {label}
        {required && <span className="text-status-error"> *</span>}
      </label>
      <textarea
        ref={ref}
        id={id}
        required={required}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 w-full border rounded-control px-3 py-2 text-sm text-gray-900 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          error ? 'border-status-error' : 'border-gray-300'
        }`}
        {...rest}
      />
      <div className="flex items-center justify-between mt-1">
        {hint && (
          <p id={hintId} className="text-[10px] text-gray-400">
            {hint}
          </p>
        )}
        {showCount && maxLength != null && (
          <span aria-live="polite" className="text-[10px] text-gray-400 ml-auto">
            {currentLength} / {maxLength}
          </span>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-status-error mt-1">
          {error}
        </p>
      )}
    </div>
  );
});
