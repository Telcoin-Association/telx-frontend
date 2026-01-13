import React from "react";
import { documentToHtmlString as documentToHtmlStringModule } from "@contentful/rich-text-html-renderer";
import { BLOCKS, Document } from "@contentful/rich-text-types";

// documentToHtmlString doesn't return image embeds, so custom options are needed
const options = {
  renderNode: {
    [BLOCKS.EMBEDDED_ASSET]: (node: Document) => {
      const fields = node.data.target.fields;
      const file = node.data.target.fields.file;
      const description = fields.description ? fields.description : "";
      const { url } = file;
      if (url.indexOf("//images") != -1) {
        return `
          <figure>
            <img class="contentful-image" src="${node.data.target.fields.file.url}"/>
            ${description && `<figcaption>${description}</figcaption>`}
          </figure>
        `;
      } else if (url.indexOf("//videos") != -1) {
        return `
          <figure>
            <video class="contentful-video" width="100%" height="auto" controls>
              <source src="${url}" type="video/mp4">
            Your browser does not support the video tag.
            </video>
            ${description && `<figcaption>${description}</figcaption>`}
          </figure>
        `;
      }
    },
    [BLOCKS.EMBEDDED_ENTRY]: (node: Document) => {
      const embedLink = node.data.target.fields.embedLink;
      return `
        <div class="video-wrapper">
          <iframe
            src="${embedLink}"
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen>
          </iframe>
        </div>
      `;
    },
  },
};

export function documentToHtmlString(doc:any) {
  return documentToHtmlStringModule(doc, options as any);
}

export type ContentfulRichTextDocument = Document;

const ContentfulRichText = (props: { document: ContentfulRichTextDocument; className?: string }) => {
  function createMarkup() {
    return { __html: documentToHtmlString(props.document) };
  }

  return (
    <div className="custom-css">
      <div className="rich-text-to-html">
        <div dangerouslySetInnerHTML={createMarkup()} className={props?.className} />
      </div>
    </div>
  );
};

export default ContentfulRichText;
