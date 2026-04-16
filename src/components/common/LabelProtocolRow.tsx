import React from "react";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import LabelValueRow from "./LabelValueRow";

export default function LabelProtocolRow({ contractData, protocol }: { contractData?: ProtocolsContractData; protocol?: string }) {
  const _protocol = protocol ? protocol : contractData?.protocol ?? "";

  return _protocol ?
    (
      <LabelValueRow label="Protocol" value={<p>{_protocol === "dfx" ? _protocol.toUpperCase() : _protocol.charAt(0).toUpperCase() + _protocol.slice(1)}</p>} />
    ) : (
      null
    );
}