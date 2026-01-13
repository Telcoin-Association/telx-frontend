import React from "react";
import { toast } from "react-toastify";
import Toast, { TransactionDetails } from "./Toast";

export const generateSuccessToast = (
  details: TransactionDetails,
  txHash = ""
) => {
  const pool = `${details?.protocol} protocol, ${details?.pool}`;
  let description = "";
  let title = "";
  switch (details.type) {
    case "approve":
      description = "Successfully approved your LP Token for staking.";
      title = "LP Token Approved";
      break;
    case "stake":
      description = `Successfully staked ${details?.stakeAmount?.toString()} LPT into the pool (${pool}).`;
      title = "Liquidity Provider Token Staked";
      break;
    case "unstake":
      description = `Successfully unstaked ${details?.unstakeAmount?.toString()} LPT from the pool (${pool}).`;
      title = "Liquidity Provider Token Unstaked";
      break;
    case "claim":
      description = `Successfully claimed all rewards (${pool}).`;
      title = "Rewards Claimed";
      break;
    case "exit":
      description = `Successfully exited position by unstaking from pool and claiming all rewards (${pool}).`;
      title = "Exited Position";
      break;
  }

  const toastComponent = (
    <Toast description={description} title={title} status="success" />
  );
  if (toast.isActive(txHash)) {
    toast.update(txHash, {
      render: toastComponent,
      type: "success",
      autoClose: 10000,
    });
  } else {
    toast.success(toastComponent, {
      draggable: true,
      autoClose: 10000,
      toastId: txHash,
    });
  }
};
