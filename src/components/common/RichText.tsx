import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

export interface RichTextProps {
  markdown: string | undefined;
  className?: string;
}

export default function RichText(props: RichTextProps) {
  const { markdown, className } = props;
  let processedMarkdown = "";
  if (typeof markdown === "string") {
    processedMarkdown = markdown
      .replace(/\n/gi, "  \n")
  }

  return (
    <div className={["md-rich-text", className].join(" ")}>
      <ReactMarkdown rehypePlugins={[rehypeRaw]} >
        {processedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
