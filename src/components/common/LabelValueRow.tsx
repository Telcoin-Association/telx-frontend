"use client";

import React from "react";
import HelpTip from "./HelpTip";

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
          <HelpTip text={helpText} label={`About ${label}`} />
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
