import React from "react";
import titleToSlug from "../../helpers/titleToSlug";
import RichText from "../common/RichText";

// types
import { AboutEntry as AboutEntryProps } from "@/types/AboutEntry";

function generateTitle(title: string, query: string) {
  let result = title;
  const indexOfQuery = title.toLowerCase().indexOf(query.toLowerCase());
  if (indexOfQuery !== -1) {
    result = [
      result.slice(0, indexOfQuery),
      "<span>",
      result.slice(indexOfQuery, indexOfQuery + query.length),
      "</span>",
      result.slice(indexOfQuery + query.length),
    ].join("");
  }

  return result;
}

function generateContentExcerpt(content: string, query: string): string {
  let processedContent = content;

  const indexOfQuery = content.toLowerCase().indexOf(query.toLowerCase());
  if (indexOfQuery !== -1) {
    processedContent = [
      content.slice(0, indexOfQuery),
      '<span class="text-blue-700">',
      content.slice(indexOfQuery, indexOfQuery + query.length),
      "</span>",
      content.slice(indexOfQuery + query.length),
    ].join("");
  }

  if (processedContent.length > 250) {
    processedContent = `${processedContent.substring(0, 247)}...`;
  }

  return processedContent;
}

interface CardSearchAboutProps {
  aboutEntry: AboutEntryProps;
  query: string;
}

export default function CardSearchAbout(props: CardSearchAboutProps) {
  const { aboutEntry, query } = props;
  const { content, title } = aboutEntry.attributes;

  const formattedContent = generateContentExcerpt(content ?? "", query);
  const formattedTitle = title ? generateTitle(title, query) : " ";

  return (
    <div className="mx-auto border border-white/10 rounded-2xl bg-gradient-to-r from-[#19245d] to-[#3057A6]  hover:to-[#19245d] custom-search-css shadow-2xl py-5 px-4">
      <a href={`/about/${title ? titleToSlug(title) : "#"}`}>
        <h4
          className="text-base font-bold text-white"
          dangerouslySetInnerHTML={{
            __html: formattedTitle,
          }}
        />
      </a>
      <div className="text-primary text-base font-normal lg:max-w-4xl -mt-3 -mb-5">
        <RichText markdown={formattedContent} />
      </div>
    </div>
  );
}