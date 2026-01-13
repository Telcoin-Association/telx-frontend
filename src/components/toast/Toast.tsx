import React from "react";
import "react-toastify/dist/ReactToastify.css";

type Status = "pending" | "error" | "success";
type TransactionsType = "approve" | "stake" | "unstake" | "claim" | "exit";
export interface TransactionDetails {
  stakeAmount?: number;
  unstakeAmount?: number;
  pool?: string;
  status?: Status;
  type: TransactionsType;
  protocol: string;
}

interface ToastProps {
  errorMessage?: string;
  description: string;
  title: string;
  status: "pending" | "error" | "success";
}

export default function Toast({ errorMessage, description, title, status }: ToastProps) {
  let color: string;

  switch (status) {
    case "success":
      color = "text-status-complete";
      break;
    case "error":
      color = "text-status-error";
      break;
    case "pending":
      color = "text-status-inProgress";
      break;
  }

  return (
    <div>
      <p className={`title ml-5 font-bold my-1 ${color}`}>
        <strong>{title}</strong>
      </p>
      <p className="description text-primary pl-5 text-sm">{description}</p>
      {errorMessage && <p className="error-message text-status-error pl-5 mt-2 break-all text-xs">{errorMessage}</p>}
    </div>
  );
}
