'use client';

import { useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const tooShort = trimmed.length < MIN_LENGTH;

  const handleSubmit = async () => {
    if (tooShort) {
      setError(`Tell us a bit more — at least ${MIN_LENGTH} characters.`);
      // frontend-standards forms rule: move focus to the first invalid
      // field after a failed submit.
      textareaRef.current?.focus();
      return;
    }
    setError('');
    await onSubmit?.(trimmed);
  };

  return (
    <div>
      <Textarea
        ref={textareaRef}
        id="match-textarea"
        label="Tell us in your own words"
        containerClassName="mb-1"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
        placeholder={placeholder}
        maxLength={MAX_LENGTH}
        rows={6}
        disabled={loading}
        showCount
        hint={error ? undefined : 'No personal info. Stays anonymous. Used only to find your match.'}
        error={error}
      />

      {/* Stays enabled below the minimum length (not `disabled={tooShort}`)
          so handleSubmit's validation actually runs on click — a silently
          disabled control gives no explanation; frontend-standards wants
          a real validation error, associated to the field, with focus
          moved there on a failed attempt. `loading` still disables it
          during an in-flight submit (Button's own prop). */}
      <Button
        type="button"
        onClick={handleSubmit}
        loading={loading}
        fullWidth
        size="lg"
      >
        {loading ? (
          'Matching...'
        ) : (
          <>
            <span>Find my match</span>
            <span className="text-blue-200 text-sm">· takes ~2s</span>
          </>
        )}
      </Button>
    </div>
  );
}
