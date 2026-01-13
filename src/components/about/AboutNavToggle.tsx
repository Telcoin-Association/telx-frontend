"use client";

import React from "react";
import { InfoCircle } from "@transferwise/icons";
import { useSkrimContext } from "../providers/SkrimProvider";

export interface BackBarProps {
  text?: string;
  onClick?: any;
  isOpen?: boolean;
  aside: any;
}

const AboutNavToggle = (props: BackBarProps) => {
  const { aside } = props;
  const { set } = useSkrimContext();

  const handleToggleAboutMenu = (e: any) => {
    e.preventDefault();
    set(aside);
  };

  return (
    <button
      className={[
        "lg:hidden bg-ocean-gradient hover:bg-ocean-gradient-dark rounded-full px-3 py-1 text-white-100 shadow-md",
        "sticky bottom-6 z-20 right-4 w-16 h-16 ml-4",
        "flex items-center justify-center",
        "lg:bottom-8 mb-8 lg:mb-20 lg:left-8 lg:shadow-none",
      ].join(" ")}
      onClick={handleToggleAboutMenu}
    >
      <InfoCircle size={24} />
    </button>
  );
};

export default AboutNavToggle;
