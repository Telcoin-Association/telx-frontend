import React from "react";
import PoolsNav from "./PoolsNav";
import PoolsHeaderStats, { PoolsHeaderStatsProps } from "./PoolsHeaderStats";
import RichText from "../common/RichText";
import Button from "../common/Button";
interface PoolsStatsProps {
  title?: string;
  description?: any;
  slug: string;
  path?: string;
  type: string; // light or dark, for determining which affiliate logo appears
  liquidityData?: PoolsHeaderStatsProps;
}

const PoolsStats = (props: PoolsStatsProps) => {
  const { title, description, slug, path, type, liquidityData } = props;

  if (type === "light") {
    return (
      <div className="flex flex-col justify-center rounded-t-xl bg-gray-200">
        <div className="mx-auto my-6 flex flex-col justify-items-center text-center">
          <h1 className="text-2xl font-bold text-gray-1100 md:text-4xl">{title}</h1>
          <div className="text-gray-800">
            <RichText markdown={description} />
          </div>
        </div>

        {liquidityData && <PoolsHeaderStats {...liquidityData} type={type} />}
        <PoolsNav slug={slug} path={path} productName={title} />
      </div>
    );
  } else if (type === "homepage") {
    return (
      <div className="flex flex-col items-center justify-center">
        {liquidityData && <PoolsHeaderStats {...liquidityData} type={type} />}
        <Button external={false} linkText="View Pools" linkUrl={slug} type="primary" className="my-6 w-full max-w-[400px] rounded-xl" />
      </div>
    );
  } else {
    return (
      <>
        <PoolsNav slug={slug} path={path} productName={title} />
        <div className="bg-stone-gradient">
          <div className="mx-auto flex max-w-xl flex-col justify-center rounded-t-none px-4 py-12">
            <div className="mx-auto flex flex-col justify-items-center text-center">
              <h1 className="text-2xl font-bold text-white-100 xl:mb-2 xl:text-5xl">{title}</h1>
              <div className="text-gray-500">
                <RichText markdown={description} />
              </div>
            </div>
            <div className="mx-auto mt-8 flex w-full flex-col justify-items-center text-center">
              <div>{liquidityData && <PoolsHeaderStats {...liquidityData} type={type} />}</div>
            </div>
          </div>
        </div>
      </>
    );
  }
};

export default PoolsStats;
