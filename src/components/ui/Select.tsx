// Shared select primitive (T18, Spec D1 / frontend-standards forms rules).

import type { SelectHTMLAttributes } from 'react';

interface Option {
  value: string;
  label: string;
}

interface Props extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> {
  id: string;
  label: string;
  options: Option[];
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export function Select({
  id,
  label,
  options,
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
      <select
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1 w-full border rounded-control px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          error ? 'border-status-error' : 'border-gray-300'
        }`}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
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
