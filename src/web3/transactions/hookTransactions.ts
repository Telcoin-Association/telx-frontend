import { generateErrorToast } from "../../components/toast/ErrorToast";
import { generatePendingToast } from "../../components/toast/PendingToast";
import { generateSuccessToast } from "../../components/toast/SuccessToast";
import { TransactionDetails } from "../../components/toast/Toast";
import STAKING_ABI from "../abis/staking_dual_rewards.json";
import TOKEN_ABI from "../abis/token.json";
import { provider } from "@/lib/alchemySdk";
import {
  Contract,
  formatUnits,
  Interface,
  MaxUint256,
  parseUnits,
} from "ethers";

const tokenInterface = new Interface(TOKEN_ABI);
const stakingInterface = new Interface(STAKING_ABI);

export async function getApprovalData(
  poolAddress: string,
  stakingAddress: string
) {
  const data = tokenInterface.encodeFunctionData("approve", [
    stakingAddress,
    MaxUint256,
  ]);
  return {
    to: poolAddress,
    data: data,
  };
}

export function getStakeData(stakingAddress: string, amount: number) {
  const normalizedAmount = parseUnits(amount.toString(), 18);
  const data = stakingInterface.encodeFunctionData("stake", [normalizedAmount]);
  return {
    to: stakingAddress,
    data: data,
  };
}

export async function getWithdrawData(
  stakingAddress: string,
  amount: number,
  userAddress: string
) {
  const normalizedAmount = parseUnits(amount.toString(), 18);
  const stakingContract = new Contract(stakingAddress, STAKING_ABI, provider);
  let balanceAmount = await stakingContract.balanceOf(userAddress);

  balanceAmount = parseInt(balanceAmount, 10);

  // if the user is withdrawing 100% of their LP
  if (balanceAmount == normalizedAmount) {
    // call the exit contract function (claim rewards)
    return {
      to: stakingAddress,
      data: stakingInterface.encodeFunctionData("exit"),
    };
  } else {
    // just withdraw LP (don't claim rewards)
    return {
      to: stakingAddress,
      data: stakingInterface.encodeFunctionData("withdraw", [normalizedAmount]),
    };
  }
}

export async function getWithdrawDataMax(
  stakingAddress: string,
  userAddress: string
): Promise<TransactionData> {
  const stakingContract = new Contract(stakingAddress, STAKING_ABI, provider);
  const balanceAmount = await stakingContract.balanceOf(userAddress);

  if (balanceAmount.gt(0)) {
    return {
      to: stakingAddress,
      data: stakingInterface.encodeFunctionData("withdraw", [balanceAmount]),
    };
  } else {
    throw new Error("User has no staked balance to withdraw.");
  }
}

export async function getExitData(stakingAddress: string) {
  return {
    to: stakingAddress,
    data: stakingInterface.encodeFunctionData("exit"),
  };
}

export async function getRewardData(stakingAddress: string) {
  return {
    to: stakingAddress,
    data: stakingInterface.encodeFunctionData("getReward"),
  };
}

export async function getAllowanceBool(
  poolAddress: string,
  userAddress: string | undefined,
  stakingAddress: string
): Promise<boolean> {
  if (!userAddress) return false;

  try {
    const poolContract = new Contract(poolAddress, TOKEN_ABI, provider);

    const [allowance, balance] = await Promise.all([
      poolContract
        .allowance(userAddress, stakingAddress)
        .then((val: bigint) => Number(formatUnits(val, 18)))
        .catch(() => 0),

      poolContract
        .balanceOf(userAddress)
        .then((val: bigint) => Number(formatUnits(val, 18)))
        .catch(() => 0),
    ]);

    return balance <= allowance;
  } catch (error) {
    console.error("Error checking allowance:", error);
    return false;
  }
}

interface TransactionData {
  to: string;
  data: any;
}

/*
 * send transaction
 * user approves in metamask
 * wait for TXHash
 *   Catch Error, CREATE ERROR NOTIFICATION
 * with TXHash, CREATE PENDING NOTIFICATION
 * wait for TX Recepit
 *   catch error (status: false) CREATE ERROR NOTIFICATION
 * once TX succeeds (status: true), CREATE SUCCESS NOTIFICATION
 */
export default async function initiateTransaction(
  alchemySdk: any,
  transactionData: TransactionData,
  selectedWalletAddress: string,
  transactionDetails: TransactionDetails,
  onConfirm: any,
  onTransact: any,
  onFinished: any,
  onError: any,
  signer: any
) {
  const { to, data } = transactionData;

  const gasPrice = await alchemySdk.core.getGasPrice();

  const transactionParameters = {
    to: to, // Required except during contract publications.
    from: selectedWalletAddress, // must match user's active address.
    data: data, // Optional, but used for defining smart contract creation and interaction.
    maxPriorityFeePerGas: gasPrice,
    maxFeePerGas: gasPrice,
  };

  // trigger UI state changes
  onConfirm();

  try {
    const txHash = await signer.sendTransaction(transactionParameters);
    // trigger UI state changes
    onTransact();
    generatePendingToast(transactionDetails, txHash);

    // poll until transaction receipt is available
    const interval = setInterval(async function () {
      const rec = await alchemySdk.core.getTransactionReceipt(txHash);
      if (rec) {
        if (rec.status) {
          // transaction suceeded
          generateSuccessToast(transactionDetails, txHash);
        } else {
          // transaction failed
          generateErrorToast(
            transactionDetails,
            "Transaction was reverted.",
            txHash
          );
        }

        onFinished();
        clearInterval(interval);
      }
    }, 1000);
  } catch (error: any) {
    console.log(error);
    // let's do show this error
    generateErrorToast(transactionDetails, error.message);

    onError();
    return;
  }
}
