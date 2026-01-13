import React from "react";
import Link from "next/link";
import { useSkrimContext } from "../providers/SkrimProvider";
import { Search as SearchIcon } from "@transferwise/icons";
import { usePathname } from "next/navigation";

export default function SearchMenuLink({ className }: { className?: string }) {
  const { clear } = useSkrimContext();
  const pathname = usePathname();

  return (
    <Link
      href="/search"
      className={[
        "rounded-full hover:bg-[#0E0E3E]/50 lg:flex lg:items-center p-2 bg-[#0E0E3E]/20",
        pathname === "/search" ? "text-white-100 hover:text-white-100 " : "bg-[#0E0E3E]/20",
        className,
      ].join(" ")}
      onClick={clear}
    >
      <div className="flex  items-center justify-center">
        <SearchIcon size={24} className={pathname === "/search" ? "lg:text-white-100 text-blue-700" : "text-white"} />
      </div>
    </Link>
  );
}
