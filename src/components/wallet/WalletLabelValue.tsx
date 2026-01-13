import React from "react";

export default function WalletLabelValue({
  label,
  description,
  value,
  border = false,
  className,
}: {
  label?: string;
  description?: string;
  value?: any;
  border?: boolean;
  className?: string;
}) {
  return (
    <div className={["flex flex-col justify-between w-full", border && "border-b border-white-100 pb-1", className].join(" ")}>
      <div className="flex justify-between w-full">
        <p className="text-gray-1100 text-sm font-bold pb-1">{label}</p>
        <div className="text-primary text-sm">{value}</div>
      </div>
      {description && <p className="text-primary text-sm my-2">{description}</p>}
    </div>
  );
}
