import React from "react";
import { Cross as CrossIcon } from "@transferwise/icons";
import { useSkrimContext } from "../providers/SkrimProvider";

export const ModalFrame = ({
  className,
  children,
  animate = { from: "none" },
}: {
  className?: string;
  children: any;
  animate?: {
    from: "top" | "bottom" | "left" | "right" | "none";
  };
}) => {
  const { onEnter, clear } = useSkrimContext();
  const closeModal = () => clear();
  const map = new Map();

  map.set("top", onEnter ? "translate-y-[0vh]" : "translate-y-[-100vh]");
  map.set("bottom", onEnter ? "translate-y-[0vh]" : "translate-y-[100vh]");
  map.set("right", onEnter ? "translate-x-[0vw]" : "translate-x-[100vw]");
  map.set("left", onEnter ? "translate-x-[0vw]" : "translate-x-[-100vw]");

  const handleClose = (event: any) => {
    event.stopPropagation(event);
    closeModal();
  };

  return (
    <div
      className={[
        "ease-in-out duration-300 transform",
        map.get(animate.from),
        className,
      ].join(" ")}
      onClick={(event) => handleClose(event)}
    >
      <CrossIcon size={24} className="text-gold-700 absolute right-3 top-3" />
      {children}
    </div>
  );
};
