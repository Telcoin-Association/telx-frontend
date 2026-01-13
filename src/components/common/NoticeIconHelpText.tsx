import React from "react";
import RichText from "./RichText";
import { InfoCircle as InfoCircleIcon } from "@transferwise/icons";

interface NoticeIconHelpTextProps {
  description: string;
  title: string;
}

const NoticeIconHelpText = (props: NoticeIconHelpTextProps) => {
  const { title, description } = props;

  return (
    <div className="notice notice-icon-help-text">
      <div className="flex flex-row space-x-2 font-bold items-center">
        <InfoCircleIcon size={24} className="text-white" />
        <h4 className="text-white">{title}</h4>
      </div>
      <div className="text-primary">
        <RichText markdown={description} />
      </div>
    </div>
  );
};

export default NoticeIconHelpText;
