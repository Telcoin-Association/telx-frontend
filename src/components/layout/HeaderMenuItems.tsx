"use client";

import React from "react";
import HeaderMenuLink from "./HeaderMenuLink";

export default function HeaderMenuItems({
  path,
  links,
}: {
  path: string;
  links: {
    link: string;
    name: string;
    pathIncludes?: string;
  }[];
}) {
  return (
    <>
      <ul className="flex flex-col lg:flex-row">
        {links.map((menuItem, i) => {
          const { link, name, pathIncludes } = menuItem;

          return pathIncludes ? (
            <HeaderMenuLink key={i} name={name} link={link} pathIncludes={pathIncludes}
            />
          ) : (
            <HeaderMenuLink key={i} name={name} link={link} pathIncludes={pathIncludes} />
          );
        })}
      </ul>
    </>
  );
}
