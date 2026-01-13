import React from "react";
import { Alert as AlertIcon } from "@transferwise/icons";
import { deprecatedPoolsListSelector } from "../../redux/slices/contractsSlice";
import { useAppSelector } from "@/redux/hooks";
import WalletItemContractItem from "./WalletItemContractItem";
import WalletLabelValue from "./WalletLabelValue";
import { ZERO_TOKEN_BALANCE } from "@/lib/constants";

export default function WalletNotifications(props: any) {
  const { notices } = props;

  const deprecatedPoolNotice =
    notices &&
    notices.filter(
      (notice: any) => notice.attributes.notice_id === "deprecated-pool"
    );
  const { description: deprecatedPoolDescription } =
    (Array.isArray(deprecatedPoolNotice) &&
      deprecatedPoolNotice.length > 0 &&
      deprecatedPoolNotice[0]?.attributes) ||
    {};
  const archivePoolsList = useAppSelector(deprecatedPoolsListSelector);
  const archivedUserPools = Object.values(archivePoolsList || {}).filter(
    (contract) => {
      const stakedLPT = contract?.user?.deprecated?.stakedLPT;
      return Number(stakedLPT) > 0 && stakedLPT !== ZERO_TOKEN_BALANCE;
    }
  );

  return archivedUserPools?.length > 0 ? (
    <div className="rounded-xl">
      <WalletLabelValue label="Notifications" value="" border={true} />
      <div>
        {archivedUserPools.map((contract) => (
          <div key={contract.stakeContractAddress}>
            <div className="flex flex-row space-x-1 my-4 text-status-inProgress font-bold text-base items-center">
              <AlertIcon />
              <p>Update requires action</p>
            </div>
            <div className="">
              <p className="px-3 mb-3 text-gray-800 font-normal text-sm">
                {deprecatedPoolDescription ?? ""}
              </p>
              <WalletItemContractItem
                contract={contract}
                stakedLPTOverride={contract?.user?.deprecated?.stakedLPT}
                stakedUSDOverride={contract?.user?.deprecated?.stakedUSD}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : (
    <></>
  );
}
