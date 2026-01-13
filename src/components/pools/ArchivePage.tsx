"use client";

import ArchiveCards from "@/components/archive/ArchiveCards";
import { useAppSelector } from "@/redux/hooks";
import { deprecatedPoolsListSelector } from "@/redux/slices/contractsSlice";
import React from "react";

export default function ArchivePage() {
  const archivePoolsList = useAppSelector(deprecatedPoolsListSelector);

  const archiveList = [...Object.values(archivePoolsList)];

  return <ArchiveCards contractsData={archiveList} />;
}
