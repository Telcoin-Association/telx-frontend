import React, { useMemo } from "react";
import BigNumber from "bignumber.js";
import {
  userContractsSelector,
  deprecatedPoolsListSelector,
} from "../../redux/slices/contractsSlice";
import { useAppSelector } from "@/redux/hooks";
import WalletItemContractItem from "./WalletItemContractItem";
import formatNumberToCurrencyString from "../../helpers/formatNumberToCurrencyString";
import WalletLabelValue from "./WalletLabelValue";

//types
import { ProtocolsContractData } from "@/web3/getContracts/shared";

export default function WalletItemContracts() {
  const userActiveContracts = useAppSelector(userContractsSelector);

  const archivePoolsList = useAppSelector(deprecatedPoolsListSelector);
  const userArchivedContracts = useMemo(() => {
    const contracts: { [key: string]: typeof archivePoolsList[string] } = {};
    Object.keys(archivePoolsList).forEach((key) => {
      const pool = archivePoolsList[key];
      if (
        pool.user.stakedLPT &&
        parseFloat(pool.user.stakedLPT.toString()) > 0
      ) {
        contracts[key] = {
          ...pool,
        };
      }
    });
    return contracts;
  }, [archivePoolsList]);

  const userTotalActiveStakedUSD = useMemo(() => {
    if (userActiveContracts && Object.keys(userActiveContracts).length > 0) {
      let total = new BigNumber(0);
      Object.values(userActiveContracts).map((contract: ProtocolsContractData) => {
        const staked = contract.user.stakedUSD;
        if (staked) {
          total = new BigNumber(staked).plus(total);
        }
      });
      const result = formatNumberToCurrencyString(total.toNumber());

      return result;
    }

    return "$0.00";
  }, [userActiveContracts]);

  const userTotalArchivedStakedUSD = useMemo(() => {
    if (
      userArchivedContracts &&
      Object.keys(userArchivedContracts).length > 0
    ) {
      let total = new BigNumber(0);
      Object.values(
        userArchivedContracts as { [key: string]: ProtocolsContractData }
      ).forEach((contract) => {
        const staked = contract.user.stakedUSD;
        if (staked) {
          total = new BigNumber(staked).plus(total);
        }
      });
      return formatNumberToCurrencyString(total.toNumber());
    }
    return "N/A";
  }, [userArchivedContracts]);

  const activeContracts = useMemo(() => {
    return Object.values(userActiveContracts).map((contract: ProtocolsContractData) => {
      return (
        <WalletItemContractItem
          key={contract.poolContractAddress}
          contract={contract}
        />
      );
    });
  }, [userActiveContracts]);

  const archivedContracts = useMemo(() => {
    return Object.values(
      userArchivedContracts as { [key: string]: ProtocolsContractData }
    ).map((contract) => {
      return (
        <WalletItemContractItem
          key={contract.poolContractAddress}
          contract={contract}
        />
      );
    });
  }, [userArchivedContracts]);

  return (
    <div className="rounded-xl text-primary">
      <WalletLabelValue
        label="Active Stakes"
        value={userTotalActiveStakedUSD + "*"}
      />
      {activeContracts.length === 0 && (
        <p className="mt-4 text-sm">
          No liquidity stakes detected on this address. After staking LP tokens
          into the TELx portal, your stakes will appear here.
        </p>
      )}
      <div className="mt-2">
        {activeContracts.length > 0 && (
          <div className="mt-1 grid gap-2">{activeContracts}</div>
        )}
      </div>

      {archivedContracts.length > 0 && (
        <>
          <WalletLabelValue
            label="Archived Stakes"
            description="These stakes are no longer accruing rewards. Please exit and re-stake to the relevant pools if available."
            value={userTotalArchivedStakedUSD + "*"}
            className="mt-12"
          />
          <div className="mt-2 grid gap-2">{archivedContracts}</div>
        </>
      )}
      {(activeContracts.length !== 0 || archivedContracts.length !== 0) && (
        <p className="mt-8 text-xs text-primary">
          *USD conversions are not real time, and are provided as approximates
          only.
        </p>
      )}
    </div>
  );
}
