import React from "react";

interface PoolsHeaderProps {
  name: string;
}

const PoolsHeader = (props: PoolsHeaderProps) => {
  const { name } = props;

  return <div className="bg-ocean-gradient opacity-90 text-white-100 font-bold text-center p-4 lg:hidden">{name}</div>;
};

export default PoolsHeader;
