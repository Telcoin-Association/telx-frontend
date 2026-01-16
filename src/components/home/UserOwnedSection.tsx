import React from "react";
import RichText from "../common/RichText";
import Button from "../common/Button";
import RightIcon from "../../../public/icons/right-Icon.svg";

export interface ServiceOverviewProps {
  overviewTitle: string;
  overviewDescription: string;
}

const UserOwnedSection = (props: ServiceOverviewProps) => {
  const { overviewTitle, overviewDescription } = props;

  return (
    <div className="h-full rounded-2xl bg-[#10124333] p-6 shadow-lg/20">
      <div className="mx-auto max-w-xl xl:mx-auto xl:flex xl:max-w-3xl xl:flex-col">
        <div className="flex flex-col">
          <h2 className="text-white-100 text-2xl">{overviewTitle}</h2>
          <RichText
            markdown={overviewDescription}
            className="text-primary"
          />
          <Button
            external={false}
            linkText="Learn More"
            linkUrl="/about/welcome-to-telx"
            type="secondary"
            className="w-fit text-[#14C8FF]!"
            rightIcon={<RightIcon height={20} width={20} />}
          />
        </div>
      </div>
    </div>
  );
};

export default UserOwnedSection;
