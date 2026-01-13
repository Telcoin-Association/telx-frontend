import React from "react";
import PageSearch from "./SearchPage";
import { getAboutPages } from "@/lib/getAboutPages";

export default async function SearchPage({
  params,
}: {
  params: Promise<{ s: string }>;
}) {
  const { s } = await params;
  const initialSearchQuery = Array.isArray(s) ? s[0] : s || "";
  const _aboutData = getAboutPages();

  return <PageSearch initialSearchQuery={initialSearchQuery} aboutPagesData={_aboutData} />;
}
