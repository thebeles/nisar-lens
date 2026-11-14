import React from 'react';

/**
 * 3x3 Architectural Dot-Matrix Grid Marker (From Pinterest Inspiration 1)
 */
export function DotGridMark({ className = '' }) {
  return (
    <div
      className={`grid grid-cols-3 gap-[3.5px] opacity-45 group-hover:opacity-85 transition-opacity duration-300 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }).map((_, idx) => (
        <span
          key={idx}
          className="w-[2.5px] h-[2.5px] rounded-full bg-white/80 block"
        />
      ))}
    </div>
  );
}

/**
 * Four-Dot Diamond / Crosshair Marker (From Pinterest Inspiration 1)
 */
export function DiamondCrosshair({ className = '' }) {
  return (
    <div
      className={`relative w-3.5 h-3.5 inline-flex items-center justify-center opacity-50 ${className}`}
      aria-hidden="true"
    >
      <span className="absolute top-0 left-1/2 -translate-x-1/2 w-[2.5px] h-[2.5px] rounded-full bg-white" />
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[2.5px] h-[2.5px] rounded-full bg-white" />
      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-[2.5px] rounded-full bg-white" />
      <span className="absolute right-0 top-1/2 -translate-y-1/2 w-[2.5px] h-[2.5px] rounded-full bg-white" />
    </div>
  );
}
