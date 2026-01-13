import React from "react";
import { toast } from "react-toastify";
import Toast, { TransactionDetails } from "./Toast";

export const generatePendingToast = (details: TransactionDetails, txHash = "") => {
  const pool = `${details?.protocol} protocol, ${details?.pool}`;
  let description = "";
  let title = "";
  switch (details.type) {
    case "approve":
      description = "This allows TELx to access your LP token. This only needs to be done once per pool.";
      title = "Approving LP Token for Staking";
      break;
    case "stake":
      description = `Now staking ${details?.stakeAmount?.toString()} LPT into the pool (${pool}).`;
      title = "Staking Liquidity Provider Token";
      break;
    case "unstake":
      description = `Now unstaking ${details?.unstakeAmount?.toString()} LPT from the pool (${pool}).`;
      title = "Unstaking Liqudity Provider Token";
      break;
    case "claim":
      description = `Now claiming rewards (${pool}).`;
      title = "Claiming Rewards";
      break;
    case "exit":
      description = `Now exiting your position by unstaking all remaining LPT and claiming all rewards (${pool}).`;
      title = "Exiting Position";
      break;
  }

  const toastComponent = <Toast description={description} title={title} status="pending" />;

  toast.warning(toastComponent, { draggable: true, autoClose: 10000, toastId: txHash });
};
