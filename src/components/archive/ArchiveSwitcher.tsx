import React from "react";

interface ArchiveHeaderProps {
  title?: string;
  subtitle?: string;
  showPools: boolean;
  contractTabTitle: string;
  poolTabTitle: string;
  setShowPools: any;
  showArchivePoolsTab: boolean;
}

const ArchiveHeader = (props: ArchiveHeaderProps) => {
  const { showPools, setShowPools, contractTabTitle, poolTabTitle, showArchivePoolsTab } = props;

  return (
    <div className="flex flex-row mx-auto justify-center pt-4 max-w-7xl border-b-[0.8px] border-gray-400">
      <div className="space-x-10 text-gray-600 font-semibold">
        <button
          className={(!showPools && "text-blue-700 border-b-2 border-blue-700 pb-4 hover:text-blue-900") || "hover:text-blue-900"}
          onClick={() => setShowPools(false)}
        >
          {contractTabTitle}
        </button>
        {showArchivePoolsTab && (
          <button
            className={(showPools && "text-blue-700 border-b-2 border-blue-700 pb-4 hover:text-blue-900") || "hover:text-blue-900"}
            onClick={() => setShowPools(true)}
          >
            {poolTabTitle}
          </button>
        )}
      </div>
    </div>
  );
};

export default ArchiveHeader;
