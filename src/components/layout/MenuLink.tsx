import React from "react";
import Link from "next/link";

interface MenuLinkProps {
  link: {
    external: boolean;
    linkText: string;
    linkUrl: string;
    helpText: string;
  };
}

const MenuLink = (props: MenuLinkProps) => {
  const { link } = props;
  const { external, linkText, linkUrl, helpText } = link;

  const externalLink = () => {
    return (
      <a className="block leading-5" href={linkUrl}>
        {helpText && <span className="font-normal leading-5 text-gray-300">{helpText} </span>}
        {linkText}
      </a>
    );
  };
  const internalLink = () => {
    return (
      <Link className="block leading-5" href={linkUrl}>
        {helpText && <span className="font-normal leading-5 text-gray-300">{helpText} </span>}
        {linkText}
      </Link>
    );
  };

  return external ? externalLink() : internalLink();
};

export default MenuLink;
