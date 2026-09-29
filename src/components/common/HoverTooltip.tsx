"use client";

import React, { useId } from "react";

// "left" keeps the tip inside its own table row, so the next row and the scroll container of the pool
// lists never cover or clip it. "below" matches the trigger's width (at least 10rem) so a tip in a narrow
// card never runs past the viewport edge.
const PLACEMENT_CLASSES = {
  left: "right-full top-1/2 mr-2 w-max max-w-60 -translate-y-1/2",
  below: "left-0 top-full mt-1 w-full min-w-40",
} as const;

/**
 * Hover and focus tooltip. The tip stays in the DOM at zero opacity, so screen readers read it as part of
 * the surrounding text and through `aria-describedby`, and sighted users see it on hover or focus.
 * `focusable` makes the trigger reachable by keyboard; leave it off inside a link, which already takes focus.
 */
export default function HoverTooltip({
  content,
  children,
  placement = "left",
  focusable = false,
  className = "",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: keyof typeof PLACEMENT_CLASSES;
  focusable?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={`group relative inline-flex items-center ${className}`} tabIndex={focusable ? 0 : undefined} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-20 rounded-lg border border-white/10 bg-theme-gradient p-2 text-left text-xs font-normal text-white opacity-0 shadow-lg shadow-black/70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 ${PLACEMENT_CLASSES[placement]}`}
      >
        {content}
      </span>
    </span>
  );
}
