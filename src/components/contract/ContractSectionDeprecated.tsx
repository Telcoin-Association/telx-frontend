import React from "react";
import { Alert as AlertIcon } from "@transferwise/icons";
import { ProtocolsContractData } from "../../web3/getContracts/shared";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  web3Selector,
  setActiveAction,
  setIsConfirming,
  setIsTransacting,
} from "../../redux/slices/web3Slice";
import { fetchAllContractData } from "../../redux/slices/contractsSlice";
import initiateTransaction, {
  getExitData,
  getWithdrawDataMax,
} from "../../web3/transactions/transactions";
import { useAccount, useWalletClient } from "wagmi";
import UnclaimedRewardsDeprecated from "../row/UnclaimedRewardsDeprecated";
import LoadingAnimation from "../common/LoadingAnimationCircle";
import RichText from "../common/RichText";
import Button from "@/components/common/Button";

// types
import { Notice as NoticeProps } from "@/types/Notice";
import { alchemySdk } from "@/lib/alchemySdk";

interface ContractSectionDeprecatedProps {
  protocol: string;
  contractData: ProtocolsContractData;
  notices: NoticeProps[];
}

//Note: the below staking contracts have errors and therefore have been deprecated within one day of release. The user need to 'Withdraw' instead of 'Claim and Exit'.
const deprecatedFaultyAddresses = [
  "0x98f4F898f52e5Fdf3eeCEfA253eA1D392F46f257",
  "0x44b01fF3f0368553DCDE2cb25Ea7DdcC2145cf2c",
  "0xB650579d2F7B73a94491dA5DeF82CD76297781E6",
  "0x0f19213cdb7149C241D36435166906ffd8f7d4f4",
  "0xDc57c2f578086809B2e5B0B059D2A43B7bC6CD30",
  "0xf0A367e32D68Ae1C4D43734f675dE8e4c2065b7e",
];

const ContractSectionDeprecated = (props: ContractSectionDeprecatedProps) => {
  const { protocol, contractData, notices } = props;

  const deprecatedNotice = notices.filter(
    (notice) => notice.attributes.notice_id === "claim-rewards-and-exit"
  );
  const {
    title: deprecatedNoticeTitle,
    description: deprecatedNoticeDescription,
  } = deprecatedNotice[0]?.attributes || {};

  const textExitDeprecated = "Please exit the deprecated contract";

  const { address: account } = useAccount();
  const { data: walletClient } = useWalletClient();

  const { activeAction, isConfirming, isTransacting } =
    useAppSelector(web3Selector);
  const dispatch = useAppDispatch();

  const { stakeAddressDeprecated } = contractData;

  // mocking these functions instead of adding notifications
  const onConfirm = () => {
    dispatch(setIsConfirming(true));
  };
  const onTransact = () => {
    dispatch(setIsConfirming(false));
    dispatch(setIsTransacting(true));
  };
  const onFinished = () => {
    dispatch(setIsTransacting(false));
    dispatch(setActiveAction(null));
    dispatch(fetchAllContractData(account));
  };
  const onError = () => {
    dispatch(setIsConfirming(false));
    dispatch(setIsTransacting(false));
    dispatch(setActiveAction(null));
  };

  // used for displaying details on the transaction notification (toast)
  const transactionDetails = {
    pool:
      contractData?.assets
        ?.map((a: any) => `${a.ticker} ${a.weight}%`)
        .join(", ") || null,
    protocol,
  };

  const onExitClicked = async () => {
    dispatch(setActiveAction("exit"));
    if (stakeAddressDeprecated && account) {
      const widthdawData = await getExitData(stakeAddressDeprecated);
      initiateTransaction(
        alchemySdk,
        widthdawData,
        account,
        { ...transactionDetails, type: "exit" },
        onConfirm,
        onTransact,
        onFinished,
        onError,
        walletClient
      );
    }
  };

  const onWithdrawClicked = async () => {
    if (account && stakeAddressDeprecated) {
      const widthdrawData = await getWithdrawDataMax(
        stakeAddressDeprecated,
        account
      );
      dispatch(setActiveAction("unstake"));
      initiateTransaction(
        alchemySdk,
        widthdrawData,
        account,
        { ...transactionDetails, type: "unstake" },
        onConfirm,
        onTransact,
        onFinished,
        onError,
        walletClient
      );
    }
  };

  let buttonText = <>{deprecatedNoticeTitle}</>;

  const isFaultyDeprecatedAddress = stakeAddressDeprecated
    ? deprecatedFaultyAddresses.includes(stakeAddressDeprecated)
    : false;

  if (isConfirming) {
    buttonText = (
      <div className="flex items-center">
        <LoadingAnimation size={24} className="mt-2" />
        <span className="ml-2 whitespace-nowrap">
          {"Confirm Exit in your wallet"}
        </span>
      </div>
    );
  } else if (isTransacting && activeAction === "exit") {
    buttonText = (
      <div className="flex items-center">
        <LoadingAnimation size={24} className="mt-2" />
        <span className="ml-2 whitespace-nowrap">{"Exit in Progress"}</span>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1 text-xl font-bold leading-6 text-status-inProgress">
        <AlertIcon />{textExitDeprecated}
      </h3>
      <RichText
        markdown={deprecatedNoticeDescription}
        className="mb-4 text-white-70"
      />
      {isFaultyDeprecatedAddress ? (
        <Button
          disabled={isConfirming || isTransacting}
          onClick={onWithdrawClicked}
          external={false}
          linkText="Withdraw"
          className="mt-4"
        />
      ) : (
        <>
          <div className="max-w-md">
            <UnclaimedRewardsDeprecated contractData={contractData} />
          </div>
          <Button
            disabled={isConfirming || isTransacting}
            onClick={onExitClicked}
            external={false}
            linkText={buttonText}
            type="primary"
            className="mt-4"
          />
        </>
      )}
    </div>
  );
};

export default ContractSectionDeprecated;
