import React, { useState } from "react";
import RichText from "../common/RichText";
import Button from "../common/Button";
import RightIcon from "../../../public/icons/right-Icon.svg";

type Feature = {
  id: number;
  attributes: {
    createdAt: string;
    updatedAt: string;
    publishedAt: string;
    title: string;
    description: string;
    cta_text: string | null;
    cta_url: string | null;
    cta_external: string | null;
    image: any;
  };
};

export interface ServiceOverviewProps {
  howItWorksTitle: string;
  howItWorksDescription: string;
  howItWorksFeatures: any;
}

const HowItWorks = (props: ServiceOverviewProps) => {
  const { howItWorksTitle, howItWorksDescription, howItWorksFeatures } = props;
  const [expandedCard, setExpandedCard] = useState<number | null>(null);

  const handleCardClick = (index: number) => {
    setExpandedCard(index === expandedCard ? null : index);
  };

  return (
    <div className="flex h-full py-4">
      <div className="mx-auto flex max-w-7xl flex-col">
        <div className="items-centermd:text-center">
          <div className="flex flex-col gap-4 rounded-2xl bg-[#10124333] p-5 shadow-lg/20">
            <div className="xl:flex xl:flex-col">
              <h2 className="text-white-100 text-3xl font-bold">{howItWorksTitle}</h2>
              <RichText markdown={howItWorksDescription} className="text-primary" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:mx-auto md:max-w-7xl lg:grid-cols-3">
              {howItWorksFeatures?.map((feature: Feature, i: number) => {
                const { description, title } = feature?.attributes || {};
                return (
                  <div key={i} className="w-full cursor-pointer rounded-xl" onClick={() => handleCardClick(i)}>
                    <div className="flex flex-col text-left">
                      <h5 className="text-white">Phase {i + 1}</h5>
                      <h3 className="text-base text-white md:text-2xl">{title}</h3>
                      <div className="text-left text-primary">
                        <RichText markdown={description} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
    </div>
  );
};

export default HowItWorks;
