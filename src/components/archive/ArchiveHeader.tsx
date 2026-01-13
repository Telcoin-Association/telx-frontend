import React from "react";

interface ArchiveHeaderProps {
  title?: string;
  subtitle?: string;
  showPools: boolean;
  contractTabTitle: string;
  poolTabTitle: string;
  setShowPools: any;
}

const ArchiveHeader = (props: ArchiveHeaderProps) => {
  const { title, subtitle, showPools, setShowPools, contractTabTitle, poolTabTitle } = props;

  return (
    <div id="archive-header">
      <div className="title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="tabs">
        <button className={(!showPools && "active") || ""} onClick={() => setShowPools(false)}>
          {contractTabTitle}
        </button>
        <button className={(showPools && "active") || ""} onClick={() => setShowPools(true)}>
          {poolTabTitle}
        </button>
      </div>
    </div>
  );
};

export default ArchiveHeader;
