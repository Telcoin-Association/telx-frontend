import React from "react";
import { ModalFrame } from "@/components/modal/ModalFrame";

export default function ModalWindow({
  className,
  children,
  from = "bottom"
} : {
  className?: string,
  children: any,
  from?: "top" | "bottom" | "left" | "right"
}) {
    return (
      <ModalFrame className={[
        "relative border border-gray-1200 rounded-lg md:w-[480px] p-4 md:p-8 lg:px-16",
        className].join(" ")} animate={{ from: from }}>
        {children}
      </ModalFrame>
    )
}
