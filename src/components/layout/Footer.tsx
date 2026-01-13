import React from "react";
import TALogo from "../../../public/logos/telcoin-association-white.svg";
import TELxLogo from "../../../public/telx-logo-white.svg";
import Link from "next/link";

type LinkType = {
  label?: string; // optional
  name: string;
  link: string;
  external: boolean;
};

const footerCols = [
  {
    label: "TELx",
    links: [
      {
        name: "Pools",
        link: "/pools",
        external: false,
      },
      {
        name: "Portfolio",
        link: "/portfolio",
        external: false,
      },
      {
        name: "About",
        link: "/about/welcome-to-telx",
        external: false,
      },
      {
        name: "Search",
        link: "/search",
        external: false,
      },
    ],
  },
  {
    label: "Telcoin Association",
    links: [
      {
        label: "Governance:",
        name: "Telcoin Association",
        link: "https://telcoin.org",
        external: true,
      },
      {
        label: "Native Token:",
        name: "TEL",
        link: "https://www.telcoin.org/documentation/telcoin-platform/telcoin-tel-token",
        external: true,
      },
      {
        label: "Blockchain:",
        name: "Telcoin Network",
        link: "https://www.telcoin.network/",
        external: true,
      },
      {
        label: "DeFi Protocol:",
        name: "TELx",
        link: "https://www.telx.network/",
        external: true,
      },
    ],
  },
];

const Footer = () => {
  return (
    <footer className="bg-gradient-to-r from-[#0f0f45] to-[#3057A6]">
      <div className="container mx-auto max-w-[1280px] px-4 py-16 xl:px-5 xl:pb-16">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-y-4">
            <Link href="/" className="block w-24">
              <TELxLogo />
            </Link>
            <div>
              <div className="flex flex-row items-center space-x-2">
                <p className="text-white-100 text-sm leading-4">Powered by</p>
                <Link href="https://telcoin.org">
                  <TALogo className="h-6" />
                </Link>
              </div>
              <p className="mt-2 max-w-[320px] text-sm text-gray-500">
                The Telcoin Association is a non-profit Swiss Verein that governs the Telcoin Platform.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-12 md:grid md:grid-cols-[1fr_1fr] md:gap-4">
            {footerCols.map((col, i) => {
              const { label, links } = col;
              return (
                <div key={i} className="flex flex-col gap-4">
                  <div>
                    <p className="text-gray-500">{label}</p>
                  </div>
                  {links && (
                    <ul className="flex flex-col gap-4">
                      {links.map((link: LinkType, i: number) =>
                        link.external ? (
                          <li key={i} className="leading-4">
                            {label && <span className="text-base text-gray-500">{link.label} </span>}
                            <a className="inline text-sm leading-4 font-bold text-white hover:text-blue-700" href={link.link}>
                              {link.name}
                            </a>
                          </li>
                        ) : (
                          <Link key={i} href={link.link}>
                            <p className="cursor-pointer text-sm leading-4 font-bold text-white hover:text-blue-700">{link.name}</p>
                          </Link>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
