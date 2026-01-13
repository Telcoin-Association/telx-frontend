import React, { ReactElement } from "react";
import { Cross as CrossIcon } from "@transferwise/icons";

export default function Modal({
  children,
  className = "",
  ctaButton,
  onClose,
  closeButton = true,
}: {
  children: ReactElement;
  className?: string;
  ctaButton?: ReactElement;
  onClose: any;
  closeButton?: boolean;
}) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose(false);
    }
  };

  return (
    <div
      className={[
        "fixed inset-0 z-50 flex items-center justify-center p-2 backdrop:blur-2xl backdrop-blur",
      ].join(" ")}
      onClick={handleClick}
    >
      <div
        className="fixed inset-0 cursor-pointer bg-ocean-gradient opacity-50"
        onClick={() => onClose(false)}
      ></div>
      <div
        className={`duration-350 relative cursor-default rounded-xl bg-gradient-to-l from-[#19245d] to-[#3057A6] px-4 py-6 shadow-lg transition-transform ease-in-out md:p-8 ${className}`}
      >
        {closeButton && (
          <div
            onClick={() => onClose(false)}
            tabIndex={0}
            className="absolute right-2 top-4 w-8 cursor-pointer text-gray-500 hover:text-primary"
          >
            <CrossIcon size={24} />
          </div>
        )}
        <div>{children}</div>
        {ctaButton && <div className="mt-4">{ctaButton}</div>}
      </div>
    </div>
  );
}
