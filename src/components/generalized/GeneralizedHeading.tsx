import React from "react";
import ReturnLogo from "../common/ReturnLogo";
import ReturnStatus from "../common/ReturnStatus";
import RichText from "../common/RichText";
import ReturnAsset from "../common/ReturnAsset";

interface GeneralizedHeadingProps {
  title: string | undefined;
  description: string | undefined;
  rewardsAmount: number;
}

export default function GeneralizedHeading(props: GeneralizedHeadingProps) {
  const { title, description, rewardsAmount } = props;
  const formattedRewardsAmount = rewardsAmount?.toLocaleString();

  return (
    <div className="border-b-[0.8px] border-gray-400 max-w-7xl mx-auto">
      <div className="flex flex-col-reverse md:flex-row justify-between mb-7 md:items-center">
        <div className="max-w-2xl">
          <h2 className="text-gray-1100 font-bold text-2xl my-2">{title}</h2>
          <div className="text-gray-800">
            {" "}
            <RichText markdown={description} />
          </div>
        </div>
        <div className="items-end flex flex-col space-y-1 mb-4 md:mb-0">
          <ReturnLogo brand="balancer" />
          <ReturnStatus status="active" />
          <h4>Rewards</h4>
          <div className="flex flex-row space-x-1 items-center justify-end">
            <ReturnAsset ticker={"TEL"} />
            <span className="font-bold">{formattedRewardsAmount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
