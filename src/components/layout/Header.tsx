import React from "react";
import Link from "next/link";
import MobileMenuDrawerToggle from "./MobileMenuDrawerToggle";
import HeaderMenuItems from "./HeaderMenuItems";
import SearchMenuLink from "./SearchMenuLink";
import TELxLogo from "../../../public/telx-logo-white.svg";
import { CustomConnectButton } from "./CustomConnectButton";

interface HeaderProps {
  mobileNavOpen: boolean;
  path: string;
  setWalletIsOpen: any;
  toggleMobileNavOpen: any;
  walletIsOpen: boolean;
}

export const telxLinks = [
  {
    link: "/pools",
    name: "Pools",
    pathIncludes: "/pools",
  },
  {
    link: "/portfolio",
    name: "Portfolio",
    pathIncludes: "/portfolio",
  },
  {
    link: "/about/welcome-to-telx",
    name: "About",
    pathIncludes: "/about",
  },
];

export const externalLinks = [
  {
    link: "https://telcoin.org/",
    name: "Telcoin Association",
  },
];

const Header = (props: HeaderProps) => {
  const { path } = props;

  return (
    <nav id="header" className={["fixed top-0 z-50 h-16 w-full bg-black/10 backdrop-blur-sm"].join(" ")}>
      <div className="flex h-16 items-center justify-between px-4 py-0 lg:h-16">
        <div className="flex items-center gap-4">
          <Link href="/" className="w-[120px] cursor-pointer">
            <TELxLogo height={36} />
          </Link>
          <div className="my-auto hidden items-center lg:flex">
            <HeaderMenuItems path={path} links={telxLinks} />
          </div>
        </div>
        <div className="flex h-[64px] items-center">
          <div className="flex items-center gap-2">
            <SearchMenuLink />
            <div className="py-3">
              <CustomConnectButton />
            </div>
            <MobileMenuDrawerToggle path={path} />
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Header;
