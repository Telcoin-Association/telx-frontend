import Link from "next/link";
import React from "react";

export interface ButtonProps {
  linkUrl?: string;
  linkText: any;
  external: boolean;
  type?: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  disabled?: boolean;
  rightIcon?: any;
  leftIcon?: any;
}

export default function Button({ linkUrl, linkText, external, type, className, onClick, disabled, rightIcon, leftIcon }: ButtonProps) {
  let classNames = "px-4 py-3 font-bold text-sm flex items-center justify-center rounded-xl cursor-pointer flex gap-1.5 items-center hover-lift";
  const disabledClass = disabled ? "bg-black/30 text-white/30 cursor-not-allowed pointer-events-none" : "";

  switch (type) {
    case "primary":
      classNames = [classNames, disabled ? "bg-black/30 text-white/30 " : "text-white bg-ocean-gradient", disabledClass].join(" ");
      break;
    case "secondary":
      classNames = [classNames, disabled ? "bg-black/30 text-white/30 " : "text-white bg-black/10 text-tblue font-bold border-[0.70px] border-[#14C8FF] transition-colors hover:border-tblue-500 hover:bg-navy/50", disabledClass].join(" ");
      break;
    case "tertiary":
      classNames = ["font-bold cursor-pointer", disabled ? "text-gray-500" : "text-blue-700 hover:text-link-hover", disabledClass].join(" ");
      break;
    case "text-button":
      classNames = [
        classNames,
        disabled ? "bg-gray-300 text-gray-500" : "bg-white-100 text-black hover:bg-accent hover:text-white",
        disabledClass,
      ].join(" ");
      break;
    case "outlined":
      classNames = [
        classNames,
        disabled
          ? "border-gray-300 text-gray-500"
          : "w-full border-0 border-t border-gray-300 border-solid rounded-none text-tblue-800 hover:bg-navy/50 hover:text-white",
        disabledClass,
      ].join(" ");
      break;
    case "small":
      classNames = [
        disabled
          ? "border-gray-300 text-gray-500"
          : "text-blue-1000 text-sm border border-blue-1000 px-2 py-[2px] rounded-md bg-white-100 transition-colors hover:bg-blue-100 cursor-pointer",
      ].join(" ");
      break;
    default:
      classNames = [
        classNames,
        disabled ? "bg-black/30 text-gray-700" : "bg-transparent border text-white-100 transition-colors hover:border-white/60 hover:bg-white/10",
        disabledClass,
      ].join(" ");
      break;
  }

  const onClickButton = (
    <button className={[classNames, className].join(" ")} onClick={onClick} disabled={disabled}>
      {leftIcon} <a>{linkText}</a>
      {rightIcon}
    </button>
  );

  const internalButton = linkUrl ? (
    <Link href={linkUrl} onClick={onClick} className={[classNames, className].join(" ")}>
      {leftIcon} {linkText}
      {rightIcon}
    </Link>
  ) : (
    <button className={[classNames, className].join(" ")} onClick={onClick} disabled={disabled}>
      {leftIcon} {linkText}
      {rightIcon}
    </button>
  );

  const externalButton = (
    <a className={[classNames, className].join(" ")} href={linkUrl} rel="noreferrer" target="_blank" {...(disabled ? { disabled: true } : {})}>
      {leftIcon} {linkText}
      {rightIcon}
    </a>
  );

  switch (type) {
    case "outlined-gradient":
      return <div className="">{external ? externalButton : internalButton}</div>;
    default:
      return external ? externalButton : onClick ? onClickButton : internalButton;
  }
}
