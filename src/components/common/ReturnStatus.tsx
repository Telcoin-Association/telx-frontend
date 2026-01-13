import React from "react";
import { CheckCircle as CheckCircleIcon, CrossCircle as CrossCircleIcon } from "@transferwise/icons";

interface ReturnStatusProps {
  status: string;
}

const ReturnStatus = (props: ReturnStatusProps) => {
  const { status } = props;

  switch (status) {
    case "deprecated":
      return (
        <div className="flex flex-row text-gray-600 items-center font-normal space-x-1 text-sm">
          <CrossCircleIcon />
          <p>Deprecated</p>
        </div>
      );

    case "active":
      return (
        <div className="flex flex-row text-green-700 items-center font-normal space-x-1 text-sm">
          <CheckCircleIcon />
          <p>Active</p>
        </div>
      );

    case "current":
      return (
        <div className="flex flex-row text-primary items-center font-normal space-x-1 text-sm">
          <CheckCircleIcon />
          <p>Current</p>
        </div>
      );
    default:
      return null;
  }
};

export default ReturnStatus;
