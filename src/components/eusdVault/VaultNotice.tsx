import React from "react";
import type { VaultView } from "@/web3/eusdVault/types";

type VaultNoticeData = NonNullable<VaultView["notice"]>;

export type VaultNoticeProps = Readonly<{ notice: VaultNoticeData }>;

const NOTICE_TONE_CLASS: Readonly<Record<VaultNoticeData["tone"], string>> = {
  info: "text-sm text-white/70",
  warning: "text-sm text-status-inProgress",
  error: "text-sm text-red-300",
  success: "text-sm text-status-complete",
};

export function VaultNotice({ notice }: VaultNoticeProps) {
  return (
    <p role={notice.tone === "error" ? "alert" : "status"} className={NOTICE_TONE_CLASS[notice.tone]}>
      {notice.message}
      {notice.href ? (
        <>
          {" "}
          <a href={notice.href} target="_blank" rel="noopener noreferrer" className="underline">
            {notice.hrefLabel ?? "View on explorer"}
          </a>
        </>
      ) : null}
    </p>
  );
}
