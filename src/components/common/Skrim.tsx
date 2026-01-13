"use client";

import React from "react";
import { default as dynamic } from "next/dynamic";
import { SetStateAction } from "react";

const Skrim = ({
  when,
  onClick,
  children,
}: {
  when: boolean;
  onClick: SetStateAction<any>;
  children?: any;
}) => {
  const bodyRef = React.useRef(document.body);

  React.useEffect(() => {
    const body = bodyRef.current;
    body.style.overflow = when ? "hidden" : "auto";
  }, [when]);

  if (!when) return <></>;

  return (
    <div
      className="fixed w-full h-full left-0 right-0 top-0 grid z-20 cursor-pointer"
      onClick={onClick}
    >
      <div className="w-full h-full bg-ocean-gradient opacity-60"></div>
      {children}
    </div>
  );
};

export default dynamic(() => Promise.resolve(Skrim), { ssr: false });
