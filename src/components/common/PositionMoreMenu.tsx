import React, { useEffect, useId, useRef, useState } from "react";

export type MoreMenuItem = { key: string; label: string; onSelect: () => void; tone?: "danger" };

/**
 * A row's secondary actions behind a "More" button: a menu button that opens a list of menu items. Arrow keys,
 * Home and End move between items, Escape closes and returns focus to the button, and a click outside or Tab
 * closes it. While `busy` (another transaction is in flight) the button stays focusable but ignores presses.
 */
export default function PositionMoreMenu({ label, items, busy = false }: { label: string; items: MoreMenuItem[]; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

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
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") close(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  };

  return (
    <div ref={wrapperRef} className="relative">
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
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-20 mt-2 flex min-w-44 flex-col overflow-hidden rounded-lg border border-popover-border bg-popover/95 py-1 shadow-xl shadow-black/50 backdrop-blur-md"
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
      )}
    </div>
  );
}
