"use client";

import React, { useEffect, useState } from "react";
import PoolsMain from "./PoolsMain";
import ArchivePage from "./ArchivePage";

type PoolTab = "active" | "archive";

/** The list filters each tab keeps in the URL; switching tabs clears them so each list starts unfiltered. */
const LIST_PARAMS = ["q", "tokens", "match", "chain"];

/** Points the URL at `tab` (`view=archive` for the archive) without the other tab's filters. */
function writeTabToUrl(tab: PoolTab) {
  const params = new URLSearchParams(window.location.search);
  LIST_PARAMS.forEach(name => params.delete(name));
  if (tab === "archive") params.set("view", "archive");
  else params.delete("view");
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

export default function PoolTabs({ miningContracts }: any) {
  const [activeTab, setActiveTab] = useState<PoolTab>("active");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "archive") setActiveTab("archive");
  }, []);

  const selectTab = (tab: PoolTab) => {
    if (tab === activeTab) return;
    writeTabToUrl(tab);
    setActiveTab(tab);
  };

  return (
    <div className="p-4">
      <div>
        <h2 className="text-2xl text-white">Pools</h2>
        <div className="my-2 flex">
          <button
            className={`cursor-pointer rounded-full ${activeTab === "active" ? "text-white-100 bg-navy/30 font-bold" : "text-primary"} px-4 py-2 hover:bg-navy/50`}
            aria-pressed={activeTab === "active"}
            onClick={() => selectTab("active")}
          >
            Active
          </button>
          <button
            className={`cursor-pointer rounded-full ${activeTab !== "active" ? "text-white-100 bg-navy/30 font-bold" : "text-primary"} px-4 py-2 hover:bg-navy/50`}
            aria-pressed={activeTab === "archive"}
            onClick={() => selectTab("archive")}
          >
            Archive
          </button>
        </div>
      </div>
      {activeTab === "active" ? <PoolsMain pools={miningContracts} /> : <ArchivePage />}
    </div>
  );
}
