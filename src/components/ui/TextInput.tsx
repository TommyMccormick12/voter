// Shared text input primitive (T18, Spec D1 / frontend-standards forms
// rules): visible label, error associated to the field via aria-describedby
// + aria-invalid.

import type { InputHTMLAttributes } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export function TextInput({
  id,
  label,
  hint,
  error,
  containerClassName = '',
  required,
  ...rest
}: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={containerClassName}>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
        {label}
        {required && <span className="text-status-error"> *</span>}
      </label>
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 w-full border rounded-control px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          error ? 'border-status-error' : 'border-gray-300'
        }`}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-[10px] text-gray-400 mt-1">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-status-error mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
