import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MoreMenuItem = { key: string; label: string; onSelect: () => void; tone?: "danger" };

/** Space between the button and the menu, and the least space the menu keeps from the viewport's edges. */
const GAP = 8;

type Placement = { top: number; left: number; above: boolean };

/**
 * Where the open menu sits: under the button, right edges aligned, or above it when the space below is too short
 * and the space above is larger. The menu stays inside the viewport horizontally.
 */
export function placeMenu(button: DOMRect, menu: { width: number; height: number }, viewport: { width: number; height: number }): Placement {
  const spaceBelow = viewport.height - button.bottom - GAP;
  const spaceAbove = button.top - GAP;
  const above = menu.height + GAP > spaceBelow && spaceAbove > spaceBelow;
  const top = above ? button.top - GAP - menu.height : button.bottom + GAP;
  const left = Math.min(Math.max(GAP, button.right - menu.width), viewport.width - menu.width - GAP);
  return { top: Math.max(GAP, top), left, above };
}

/**
 * A row's secondary actions behind a "More" button: a menu button that opens a list of menu items. The menu is
 * rendered on top of the page rather than inside the row, so a list container that clips its rows (for rounded
 * corners) can't cut it off, and it opens upward when the button sits near the bottom of the viewport.
 *
 * Arrow keys, Home and End move between items; Escape or Tab closes it and returns focus to the button; a click
 * outside closes it. While `busy` (another transaction is in flight) the button stays focusable but ignores presses.
 */
export default function PositionMoreMenu({ label, items, busy = false }: { label: string; items: MoreMenuItem[]; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const reposition = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    setPlacement(
      placeMenu(button.getBoundingClientRect(), { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, []);

  // Measure once the menu is in the page, before it paints, so it never flashes in the wrong place.
  useLayoutEffect(() => {
    if (open) reposition();
    else setPlacement(null);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    // Scrolling any container moves the button, so the menu follows it.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  if (items.length === 0) return null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (event: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex(item => item === document.activeElement);
    const focusAt = (index: number) => itemRefs.current[(index + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown") focusAt(current + 1);
    else if (event.key === "ArrowUp") focusAt(current - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(items.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") close(true);
    else return;
    event.preventDefault();
  };

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKey}
      data-placement={placement?.above ? "above" : "below"}
      style={{ position: "fixed", top: placement?.top ?? 0, left: placement?.left ?? 0, visibility: placement ? "visible" : "hidden" }}
      className="z-50 flex min-w-44 flex-col overflow-hidden rounded-lg border border-popover-border bg-popover/95 py-1 shadow-xl shadow-black/50 backdrop-blur-md"
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={element => {
            itemRefs.current[index] = element;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close(true);
            item.onSelect();
          }}
          className={`min-h-10 px-4 py-2 text-left text-sm transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none ${
            item.tone === "danger" ? "text-red-300" : "text-white"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) setOpen(value => !value);
        }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" && !open && !busy) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-white/15 text-lg leading-none text-white transition-colors hover:bg-navy/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && createPortal(menu, document.body)}
    </div>
  );
}
