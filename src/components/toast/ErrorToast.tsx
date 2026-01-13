import React from "react";
import { toast } from "react-toastify";
import Toast, { TransactionDetails } from "./Toast";

export const generateErrorToast = (
details: TransactionDetails, errorMessage?: any, txHash = "") => {
  const pool = `${details?.protocol} protocol, ${details?.pool}`;
  let description = "";
  let title = "";
  switch (details.type) {
    case "approve":
      description = "Something went wrong while Approving your LP Token:";
      title = "Error Approving LP Token";
      break;
    case "stake":
      description = `Error while staking ${details?.stakeAmount?.toString()} LPT into the pool (${pool}):`;
      title = "Error Staking LP Token";
      break;
    case "unstake":
      description = `Error while unstaking ${details?.unstakeAmount?.toString()} LPT from the pool (${pool}):`;
      title = "Error Unstaking LP Token";
      break;
    case "claim":
      description = `Error while claiming rewards (${pool}):`;
      title = "Error Claiming Rewards";
      break;
    case "exit":
      description = `Error while exiting from the pool (${pool}):`;
      title = "Error Exiting Position";
      break;
  }

  const toastComponent = (
    <Toast
      description={description}
      title={title}
      errorMessage={errorMessage}
      status="error"
    />
  );

  if (toast.isActive(txHash)) {
    toast.update(txHash, {
      render: toastComponent,
      type: "error",
      autoClose: 10000,
    });
  } else {
    toast.error(toastComponent, {
      draggable: true,
      autoClose: 10000,
      toastId: txHash,
    });
  }
};
