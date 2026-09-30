import React, { useId } from "react";

export type VaultCardProps = Readonly<{
  title?: React.ReactNode;
  children: React.ReactNode;
  /** Applied to the outer frame, for the page's width and placement. */
  className?: string;
}>;

/** The upgrade portal's card: a one-pixel gradient frame around a dark blue gradient panel. */
export function VaultCard({ title, children, className = "" }: VaultCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={`h-fit min-w-0 rounded-xl bg-linear-to-b from-white/32 to-white/0 p-px text-white shadow-2xl ${className}`}
    >
      <div className="flex w-full min-w-0 flex-col gap-2 rounded-xl bg-linear-to-b from-[#1A3372] to-[#0C1238] px-4 py-6 md:p-8 lg:gap-8">
        {title ? (
          <h2 id={titleId} className="text-xl md:text-2xl">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </section>
  );
}
