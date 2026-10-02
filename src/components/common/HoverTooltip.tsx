"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Placement = "below" | "above" | "left";

/** Space between the trigger and the tip, and the least space kept between the tip and the viewport edge. */
const GAP_PX = 6;
const EDGE_PX = 8;
/** How long the tip stays after the pointer leaves, so it can cross the gap onto the tip itself. */
const HIDE_DELAY_MS = 150;

/**
 * Where the tip goes for a trigger at `trigger`, a tip of `size` and a viewport of `viewport`: on the preferred
 * side when it fits, on the opposite side when it does not, and always shifted to stay inside the viewport.
 */
export function tooltipPosition(
  trigger: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: Placement,
): { top: number; left: number } {
  let top: number;
  let left: number;
  if (placement === "left") {
    left = trigger.left - GAP_PX - size.width;
    top = (trigger.top + trigger.bottom) / 2 - size.height / 2;
    if (left < EDGE_PX) {
      left = trigger.left;
      top = trigger.bottom + GAP_PX;
    }
  } else {
    const below = trigger.bottom + GAP_PX;
    const above = trigger.top - GAP_PX - size.height;
    const fitsBelow = below + size.height <= viewport.height - EDGE_PX;
    const fitsAbove = above >= EDGE_PX;
    top = placement === "above" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
    left = trigger.left;
  }
  const maxLeft = Math.max(EDGE_PX, viewport.width - size.width - EDGE_PX);
  const maxTop = Math.max(EDGE_PX, viewport.height - size.height - EDGE_PX);
  return { top: Math.min(Math.max(top, EDGE_PX), maxTop), left: Math.min(Math.max(left, EDGE_PX), maxLeft) };
}

/**
 * A tooltip on a button trigger. It opens on hover, on keyboard focus and on a tap or click, stays open while
 * the pointer is over the tip, and closes on Escape, on a press elsewhere, or when the pointer or focus
 * leaves. The tip is rendered into the document body at a fixed position kept inside the viewport, so no
 * table row, sticky header or scroll container can cover or clip it.
 *
 * The trigger is a button, so it must not sit inside a link or another button. `label` names the trigger when
 * its visible content alone does not say what it is about, and the tip is its description.
 */
export default function HoverTooltip({
  content,
  children,
  label,
  placement = "below",
  className = "",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  label?: string;
  placement?: Placement;
  className?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  // Opened by a click or tap: stays open when the pointer leaves, until dismissed.
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => clearTimeout(hideTimer.current);
  }, []);

  const show = useCallback(() => {
    clearTimeout(hideTimer.current);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    clearTimeout(hideTimer.current);
    setOpen(false);
    setPinned(false);
    setPosition(null);
  }, []);

  const hideSoon = useCallback(() => {
    if (pinned) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(close, HIDE_DELAY_MS);
  }, [pinned, close]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || tipRef.current?.contains(target))) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!trigger || !tip) return;
      setPosition(
        tooltipPosition(
          trigger,
          { width: tip.width, height: tip.height },
          { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight },
          placement,
        ),
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, placement]);

  const tip = (
    <span
      ref={tipRef}
      id={id}
      role="tooltip"
      hidden={!open}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
      className="fixed z-50 block w-max max-w-[min(16rem,calc(100vw-1rem))] rounded-lg border border-popover-border bg-popover/95 px-3 py-2 text-left text-xs leading-relaxed font-normal text-white shadow-xl shadow-black/50 backdrop-blur-md motion-safe:animate-fade-in"
    >
      {content}
    </span>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={(event) => {
          if (!tipRef.current?.contains(event.relatedTarget as Node | null)) close();
        }}
        onClick={() => {
          if (pinned) {
            close();
          } else {
            show();
            setPinned(true);
          }
        }}
        className={`inline-flex cursor-help items-center rounded bg-transparent p-0 text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${className}`}
      >
        {children}
      </button>
      {mounted ? createPortal(tip, document.body) : null}
    </>
  );
}
