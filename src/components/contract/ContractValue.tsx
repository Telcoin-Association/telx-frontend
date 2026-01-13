import React from "react";
import { InfoCircle as InfoCircleIcon } from "@transferwise/icons";

interface ContractValueProps {
  title: string;
  value: any;
  helpText?: any;
}

const ContractValue = (props: ContractValueProps) => {
  const { title, value, helpText } = props;

  return (
    <div className="contract-value">
      <div className="label-and-icon">
        <h4>{title}</h4>
        {helpText && (
          <>
            <InfoCircleIcon />
            <div className="tool-tip">{typeof helpText === "object" ? <div>{helpText}</div> : <p>{helpText}</p>}</div>
          </>
        )}
      </div>
      {typeof value === "object" ? <div className="value">{value}</div> : <p className="value">{value}</p>}
    </div>
  );
};

export default ContractValue;
