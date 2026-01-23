"use client";

import React, { useRef } from "react";
import useClickedOutsideRef from "../../helpers/useClickedOutsideRef";
import titleToSlug from "../../helpers/titleToSlug";
import Link from "next/link";
import { useSkrimContext } from "@/components/providers/SkrimProvider";
import { AboutEntry as AboutEntryProps } from "@/types/AboutEntry";

export interface AboutMenuItem {
  category: string;
  slug: string;
  title: string;
  categoryIndex: number;
}

interface AboutAsideProps {
  organizedSideMenu: {
    category: string;
    items: AboutMenuItem[];
  }[];
  selectedEntry?: AboutEntryProps;
  toggleAboutNavOpen?: any;
}

const AboutAside = (props: AboutAsideProps) => {
  const { organizedSideMenu, selectedEntry, toggleAboutNavOpen } = props;
  const selectedEntryTitle = selectedEntry?.attributes?.title;
  const wrapperRef = useRef(null);
  
  useClickedOutsideRef(
    wrapperRef,
    () => toggleAboutNavOpen && toggleAboutNavOpen(false)
  );
  const { onEnter } = useSkrimContext();

  return (
    <div
      className={[
        "bg-linear-to-r from-[#19245d] to-[#3057A6] overflow-y-auto fixed inset-y-0 z-20 transition-all shadow-2xl",
        "h-[calc(100%-64px)] w-[calc(100%-64px)] max-w-100 top-16",
        "absolute transition-transform ease-in-out duration-150",
        onEnter ? "translate-x-[0%]" : "-translate-x-full",
        "py-4 lg:py-10",
      ].join(" ")}
      ref={wrapperRef}
    >
      <div className="pl-4 pr-6 lg:p-0 lg:mx-10 py-4">
        {organizedSideMenu &&
          organizedSideMenu.map((catObj, i) => {
            const { category, items } = catObj;
            return (
              <div id="about-nav-category" key={i}>
                <h4 className="text-white pt-8 pb-1 mb-2 border-b border-white/20">
                  About {category}
                </h4>
                <ul>
                  {items.map((item, i) => {
                    const { title, slug } = item;
                    return (
                      <li
                        key={i}
                        className={`py-1 aside-menu-item ${title === selectedEntryTitle ? "selected" : ""
                          }`}
                      >
                        <Link
                          href={`/about/${titleToSlug(slug)}`}
                          className={`hover:text-white text-sm ${title === selectedEntryTitle
                            ? "text-white font-bold"
                            : "text-tblue-800"
                            }`}
                        >
                          {title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default AboutAside;
