"use client";

import React, { useState } from "react";
import PoolsMain from "./PoolsMain";
import ArchivePage from "./ArchivePage";

export default function PoolTabs({ miningContracts }: any) {
  const [activeTab, setActiveTab] = useState("active");

  return (
    <div className="p-4">
      <div>
        <h2 className="text-2xl text-white">Pools</h2>
        <div className="my-2 flex">
          <button
            className={`cursor-pointer rounded-full ${activeTab === "active" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} px-4 py-2 hover:bg-[#0E0E3E]/50`}
            onClick={() => {
              setActiveTab("active");
            }}
          >
            Active
          </button>
          <button
            className={`cursor-pointer rounded-full ${activeTab !== "active" ? "text-white-100 bg-[#0E0E3E]/30 font-bold" : "text-primary"} px-4 py-2 hover:bg-[#0E0E3E]/50`}
            onClick={() => {
              setActiveTab("archive");
            }}
          >
            Archive
          </button>
        </div>
      </div>
      {activeTab === "active" ? <PoolsMain pools={miningContracts} /> : <ArchivePage />}
    </div>
  );
}
