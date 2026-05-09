'use client';

import { useEffect, useRef, useState } from 'react';
import type { CandidateWithFullData } from '@/types/database';
import { CandidateScorecard } from './CandidateScorecard';

interface Props {
  candidates: CandidateWithFullData[];
  raceId: string;
  /** Layout: 'carousel' = mobile horizontal scroll, 'grid' = desktop 4-col */
  layout?: 'carousel' | 'grid' | 'auto';
}

/**
 * Scorecard carousel.
 *
 * Mobile (default): horizontal scroll-snap carousel. One card visible at a time,
 * pagination dots show position, "Swipe to see more" hint below.
 *
 * Desktop ('grid' layout): responsive grid (1/2/4 columns by breakpoint),
 * all cards visible at once, no swipe needed.
 *
 * 'auto' (recommended): grid on lg+ screens, carousel on smaller.
 */
export function ScorecardCarousel({ candidates, raceId, layout = 'auto' }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Detect which card is visible (carousel only)
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    if (layout === 'grid') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.index ?? '0'
            );
            setActiveIndex(idx);
          }
        }
      },
      { root: track, threshold: [0.6] }
    );

    track.querySelectorAll('[data-card]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [layout, candidates.length]);

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <p className="text-gray-500 text-lg mb-2">No candidates yet</p>
        <p className="text-gray-400 text-sm">
          Candidate data for this race is being curated.
        </p>
      </div>
    );
  }

  const handleSaved = (id: string, saved: boolean) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (saved) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // ============================================================
  // Grid layout (desktop)
  // ============================================================
  if (layout === 'grid') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {candidates.map((c, idx) => (
          <CandidateScorecard
            key={c.id}
            candidate={c}
            raceId={raceId}
            viewOrder={idx + 1}
            isActive
            initialSaved={savedIds.has(c.id)}
            onSaved={(s) => handleSaved(c.id, s)}
          />
        ))}
      </div>
    );
  }

  // ============================================================
  // Auto: grid on lg+, carousel below
  // ============================================================
  if (layout === 'auto') {
    return (
      <>
        {/* Desktop grid */}
        <div className="hidden lg:grid lg:grid-cols-4 gap-5">
          {candidates.map((c, idx) => (
            <CandidateScorecard
              key={c.id}
              candidate={c}
              raceId={raceId}
              viewOrder={idx + 1}
              isActive
              initialSaved={savedIds.has(c.id)}
              onSaved={(s) => handleSaved(c.id, s)}
            />
          ))}
        </div>
        {/* Mobile/tablet carousel */}
        <div className="lg:hidden">
          <CarouselTrack
            trackRef={trackRef}
            candidates={candidates}
            raceId={raceId}
            activeIndex={activeIndex}
            savedIds={savedIds}
            onSaved={handleSaved}
          />
        </div>
      </>
    );
  }

  // ============================================================
  // Carousel-only
  // ============================================================
  return (
    <CarouselTrack
      trackRef={trackRef}
      candidates={candidates}
      raceId={raceId}
      activeIndex={activeIndex}
      savedIds={savedIds}
      onSaved={handleSaved}
    />
  );
}

function CarouselTrack({
  trackRef,
  candidates,
  raceId,
  activeIndex,
  savedIds,
  onSaved,
}: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  candidates: CandidateWithFullData[];
  raceId: string;
  activeIndex: number;
  savedIds: Set<string>;
  onSaved: (id: string, saved: boolean) => void;
}) {
  return (
    <div className="relative">
      <div
        ref={trackRef}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth py-3"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {candidates.map((c, idx) => (
          <div
            key={c.id}
            data-card
            data-index={idx}
            className="flex-shrink-0 snap-center snap-always"
            style={{ width: 'calc(100% - 48px)', maxWidth: 420 }}
          >
            <CandidateScorecard
              candidate={c}
              raceId={raceId}
              viewOrder={idx + 1}
              isActive={idx === activeIndex}
              initialSaved={savedIds.has(c.id)}
              onSaved={(s) => onSaved(c.id, s)}
            />
          </div>
        ))}
      </div>

      {/* Pagination dots */}
      <div className="flex justify-center items-center gap-1.5 py-3">
        {candidates.map((_, idx) => (
          <span
            key={idx}
            className={`rounded-full transition-all ${
              idx === activeIndex ? 'w-6 h-1.5 bg-gray-900' : 'w-1.5 h-1.5 bg-gray-300'
            }`}
            aria-hidden="true"
          />
        ))}
      </div>

      <p className="text-xs text-gray-500 text-center mt-1">
        Swipe to see more · {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}
