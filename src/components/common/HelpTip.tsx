"use client";

import React from "react";
import { InfoCircle as InfoCircleIcon } from "@transferwise/icons";
import HoverTooltip from "./HoverTooltip";

/** An info icon that explains the figure or action next to it, on hover, focus or tap. */
export default function HelpTip({
  text,
  label,
  placement = "above",
}: {
  text: React.ReactNode;
  /** Names the icon for assistive technology, for example "About Volume (24hr)". */
  label: string;
  placement?: "below" | "above" | "left";
}) {
  return (
    <HoverTooltip content={text} label={label} placement={placement} className="text-blue-700">
      <span aria-hidden="true" className="inline-flex">
        <InfoCircleIcon />
      </span>
    </HoverTooltip>
  );
}
