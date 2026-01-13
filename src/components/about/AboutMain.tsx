"use client";

import React from "react";
import RichText from "../common/RichText";
import PrevNext from "./PrevNext";

// types
import { AboutEntry as AboutEntryProps } from "@/types/AboutEntry";

interface AboutMenuItem {
  category: string;
  slug: string;
  title: string;
  categoryIndex: number;
}

const AboutMain = ({
  selectedEntry,
  organizedSideMenu,
}: {
  organizedSideMenu: {
    category: string;
    items: AboutMenuItem[];
  }[];
  selectedEntry?: AboutEntryProps;
  onTapNavTraySelect?: any;
  path?: string;
  selectedSection?: number;
}) => {
  const { category, content, title } = selectedEntry?.attributes || {};
  // get previous and next pages
  const allItemsInOrder: AboutMenuItem[] = [];
  organizedSideMenu.map((category) => {
    category.items.map((item) => {
      allItemsInOrder.push(item);
    });
  });

  const selectedItemTitle = title;
  let previousItem: any;
  let nextItem: any;
  let thisI: number;

  allItemsInOrder.map((item, i) => {
    if (item.title === selectedItemTitle) {
      thisI = i;
      return;
    }
  });

  allItemsInOrder.map((item, i) => {
    const prevI = thisI - 1;
    const nextI = thisI + 1;
    if (i === prevI) {
      previousItem = item;
    }
    if (i === nextI) {
      nextItem = item;
    }
  });

  return (
    <div
      className="flex items-center w-full max-w-xl xl:max-w-3xl m-auto"
    >
      <div className="justify-center mx-auto pt-12 px-4 md:px-0">
        <div className="main-title">
          <h4 className="text-primary">About {category}</h4>
          <h1 className="text-white text-3xl mt-1 mb-4">
            {title}
          </h1>
        </div>
        <div className="text-primary custom-css w-full overflow-x-auto">
          {content ? <RichText markdown={content} /> : null}
        </div>
        <PrevNext
          previousItem={previousItem}
          nextItem={nextItem}
          urlBase="/about/"
        />
      </div>
    </div>
  );
};

export default AboutMain;
