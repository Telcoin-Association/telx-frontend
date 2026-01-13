import React from "react";
import LoadingAnimation from "@/components/common/LoadingAnimationCircle";

export default function LoadingWrapper() {
  return (
    <div className="h-[calc(100vh-200px)] flex items-center justify-center">
      <LoadingAnimation theme="extra-light" message="Loading on-chain data..." />
    </div>
  );
}
