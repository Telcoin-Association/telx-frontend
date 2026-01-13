import React from "react";
import RichText from "../common/RichText";
import Button from "../common/Button";
import RightIcon from "../../../public/icons/right-Icon.svg";

export interface SectionPoolsProps {
  productsTitle: any;
  productsDescription: any;
}

const TELxLaunchesSection = (props: SectionPoolsProps) => {
  const { productsTitle, productsDescription } = props;

  return (
    <div className="h-full rounded-2xl bg-[#10124333] p-6 shadow-lg/20">
      <div className="mx-auto flex max-w-xl flex-col gap-4 xl:mx-auto xl:flex xl:max-w-3xl xl:flex-col">
        <h1 className="w-auto text-2xl text-[#ffffff]">{productsTitle}</h1>
        <RichText markdown={productsDescription} className="max-w-[45rem] text-primary md:px-0" />
        <Button
          external={false}
          linkText="How Do I Provide Liquidity?"
          linkUrl="/about/how-do-i-provide-liquidity"
          type="secondary"
          className="w-fit !text-[#14C8FF]"
          rightIcon={<RightIcon height={20} width={20} />}
        />
      </div>
    </div>
  );
};

export default TELxLaunchesSection;
