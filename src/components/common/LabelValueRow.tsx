"use client";

import React from "react";
import { useState, useEffect, useRef } from "react";
import { InfoCircle as InfoCircleIcon } from "@transferwise/icons";

export default function LabelValueRow({
  label,
  value,
  helpText,
  grid = false,
  smallValue = false,
  mode = "dark",
}: {
  label: string;
  value: any;
  helpText?: string;
  grid?: boolean;
  smallValue?: boolean;
  mode?: "light" | "dark";
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // To close tooltip when the user clicks outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [tooltipRef]);

  const returnLabel = (
    <h4
      className={[
        "leading-5 text-primary text-xs",
      ].join(" ")}
    >
      {label}
    </h4>
  );

  return (
    <div
      className={[
        "relative py-3 px-4 bg-black/20 rounded-2xl",
        "text-primary",
        grid ? "grid grid-cols-[150px_1fr]" : "flex flex-col justify-between ",
      ].join(" ")}
    >
      {helpText ? (
        <div className="flex flex-row items-center space-x-2 text-xs">
          {returnLabel}
          <div
            className="relative cursor-pointer text-blue-700"
            onClick={() => setShowTooltip(true)}
            ref={tooltipRef}
          >
            {showTooltip && (
              <div
                className="absolute bottom-full z-10 mt-2 w-60 border border-white/10 rounded-lg bg-theme-gradient p-2 text-sm text-white shadow-lg shadow-black/70 md:w-72"
                onMouseLeave={() => setShowTooltip(false)}
              >
                {typeof helpText === "object" ? (
                  <div>{helpText}</div>
                ) : (
                  <p>{helpText}</p>
                )}
              </div>
            )}
            <InfoCircleIcon />
          </div>
        </div>
      ) : (
        returnLabel
      )}
      <div
        className={[
          "break-all text-start ",
          mode === "light" ? "text-white-100" : "text-white",
          smallValue && "text-base",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}
