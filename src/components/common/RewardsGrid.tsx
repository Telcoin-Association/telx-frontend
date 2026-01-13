
import React from "react";


export default function RewardsGrid({
  children
}:{
  children: any;
}) {

  return (
    <div className="grid gap-1">
      {children}
    </div>
  )
}
