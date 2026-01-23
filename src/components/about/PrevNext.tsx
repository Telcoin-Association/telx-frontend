import React from "react";
import Link from "next/link";
import { ChevronLeft } from "@transferwise/icons";
import { ChevronRight } from "@transferwise/icons";
import { AboutMenuItem } from "./AboutAside";

interface PrevNextProps {
  previousItem: AboutMenuItem;
  nextItem: AboutMenuItem;
  urlBase: string;
}

const PrevNext = (props: PrevNextProps) => {
  const { previousItem, nextItem, urlBase } = props;
  return (
    <div className="flex flex-row justify-between gap-2 my-10 py-4">
      <div className="prev">
        {previousItem && (
          <Link
            href={`${urlBase}${previousItem.slug}`}
            className="flex items-center gap-2 text-tblue-800 hover:text-tblue-900 text-sm border px-3 py-2 rounded-md bg-black/10"
          >
            <ChevronLeft />
            <p>{previousItem.title}</p>
          </Link>
        )}
      </div>
      <div className="next">
        {nextItem && (
          <Link
            href={`${urlBase}${nextItem.slug}`}
            className="flex items-center gap-2 text-blue-700! hover:text-blue-800! text-sm cursor-pointer border px-3 py-2 rounded-md  bg-black/10"
          >
            <p>{nextItem.title}</p>
            <ChevronRight />
          </Link>
        )}
      </div>
    </div>
  );
};

export default PrevNext;
