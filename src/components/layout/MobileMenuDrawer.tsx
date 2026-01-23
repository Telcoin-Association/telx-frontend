import React from "react";
import { default as dynamic } from "next/dynamic";
import TELxLogo from "../../../public/telx-logo-white.svg";
import { Cross as CrossIcon } from "@transferwise/icons";
import HeaderMenuItems from "@/components/layout/HeaderMenuItems";
import Link from "next/link";
import { useSkrimContext } from "@/components/providers/SkrimProvider";
import { telxLinks, externalLinks } from "./Header";

const WalletDrawer = ({
  className,
  path,
}: {
  className?: string;
  path: string;
}) => {
  const { onEnter, clear } = useSkrimContext();

  return (
    <div
      id="mobile-menu-drawer"
      onClick={(event) => event.stopPropagation()}
      className={[
        "absolute bottom-0 right-0 top-16 bg-theme-gradient h-full w-[calc(100%-64px)] max-w-100 transform cursor-pointer bg-ocean-gradient transition-all duration-150 ease-in-out lg:hidden",
        onEnter ? "translate-x-0" : "translate-x-full",
        className,
      ].join(" ")}
    >
      <div
        className="absolute right-4 top-6 cursor-pointer text-white"
        onClick={() => clear()}
      >
        <CrossIcon />
      </div>
      <div className="mb-8 mt-12 flex flex-col items-center justify-center space-y-2 md:mt-32">
        <Link href="/" className="mb-1 w-32" onClick={() => clear()}>
          <TELxLogo />
        </Link>
      </div>
      <div className="px-2">
        <HeaderMenuItems path={path} links={telxLinks} />
        <HeaderMenuItems path={path} links={externalLinks} />
      </div>
    </div>
  );
};

export default dynamic(() => Promise.resolve(WalletDrawer), { ssr: false });
