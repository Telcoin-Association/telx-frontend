import React from "react";
import Link from "next/link";
import { useSkrimContext } from "../providers/SkrimProvider";
import { usePathname } from "next/navigation";

export default function HeaderMenuLink({
  name,
  link,
  className,
  pathIncludes,
}: {
  name: string;
  link?: string;
  className?: string;
  pathIncludes?: string;
}) {
  const { clear } = useSkrimContext();
  const pathname = usePathname();

  return (
    <>
      {link ? (
        <Link
          href={link}
          className={[
            "border-white-30 flex items-center rounded-full px-4 py-2 lg:px-5",
            pathIncludes && pathname?.includes(pathIncludes)
              ? "text-white-100 bg-[#0E0E3E]/20 hover:bg-[#0E0E3E]/50 font-bold"
              : "text-primary hover:bg-[#0E0E3E]/50 lg:bg-none",
            className,
          ].join(" ")}
          onClick={clear}
        >
          {name}
        </Link>
      ) : (
        <></>
      )}
    </>
  );
}
