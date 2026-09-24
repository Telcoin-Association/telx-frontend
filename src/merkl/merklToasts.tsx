"use client";

/**
 * Toast notifications for the Merkl claim flow, using the shared Toast design.
 */

import React from "react";
import { toast } from "react-toastify";
import Toast from "@/components/toast/Toast";

export function notifyMerklClaimRejected() {
  toast.info(
    <Toast
      status="pending"
      title="Transaction Cancelled"
      description="You rejected the claim request in your wallet. No rewards were claimed."
    />,
    { toastId: "merkl-claim-rejected", autoClose: 6000, draggable: true }
  );
}

export function notifyMerklClaimError(errorMessage: string) {
  toast.error(
    <Toast
      status="error"
      title="Error Claiming Rewards"
      description="Something went wrong while claiming your Merkl rewards:"
      errorMessage={errorMessage}
    />,
    { toastId: "merkl-claim-error", autoClose: 10000, draggable: true }
  );
}

export function notifyMerklClaimSuccess() {
  toast.success(
    <Toast
      status="success"
      title="Rewards Claimed"
      description="Your Merkl TEL rewards were claimed successfully."
    />,
    { toastId: "merkl-claim-success", autoClose: 10000, draggable: true }
  );
}
