import React from "react";
import { CrossCircle } from "@transferwise/icons";

import RichText from "./RichText";

interface NoticeBigProps {
  description: string;
  title: string;
}

const NoticeBig = (props: NoticeBigProps) => {
  const { title, description } = props;
  return (
    <div className="shadow-lg bg-theme-gradient flex flex-col mx-4 md:mx-auto justify-center max-w-xl px-6 py-12 md:px-12 text-center items-center rounded-2xl">
      <CrossCircle size={32} className="text-white" />
      <h4 className="text-white font-bold text-xl mt-2">{title}</h4>
      <div className="text-primary">
        <RichText markdown={description} />
      </div>
    </div>
  );
};

export default NoticeBig;
