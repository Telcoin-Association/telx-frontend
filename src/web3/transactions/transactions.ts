import { generateErrorToast } from "../../components/toast/ErrorToast";
import { generatePendingToast } from "../../components/toast/PendingToast";
import { generateSuccessToast } from "../../components/toast/SuccessToast";
import { TransactionDetails } from "../../components/toast/Toast";
import STAKING_ABI from "../abis/staking_dual_rewards.json";
import TOKEN_ABI from "../abis/token.json";
import { provider } from "@/lib/ethersProvider";
import { polygon } from "viem/chains";
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

/** The chain every staking contract behind initiateTransaction lives on. */
export const STAKING_CHAIN = polygon;

/**
 * Asks the wallet behind `signer` (a viem wallet client) to switch to the staking chain. Throws when the
 * wallet refuses or cannot switch, so the caller can stop before building a transaction.
 */
export async function switchToStakingChain(signer: any): Promise<void> {
  if (typeof signer?.getChainId === "function" && (await signer.getChainId()) === STAKING_CHAIN.id) return;
  if (typeof signer?.switchChain !== "function") {
    throw new Error("The connected wallet cannot switch networks");
  }
  await signer.switchChain({ id: STAKING_CHAIN.id });
}

interface TransactionData {
  to: string;
  data: any;
}

/** How long to wait for a staking transaction's receipt before giving up on it. */
export const RECEIPT_TIMEOUT_MS = 5 * 60_000;

/** Delay between receipt lookups, about one Polygon block. */
export const RECEIPT_POLL_MS = 2_000;

/**
 * Looks up `txHash`'s receipt one request at a time, so lookups never overlap. A failed lookup (a proxy
 * error, a rate limit, a network blip) is retried on the next tick. Resolves with the receipt, or null
 * when none arrives within `timeoutMs`, for example after the wallet dropped or replaced the transaction.
 */
export async function waitForReceipt(
  txHash: string,
  { timeoutMs = RECEIPT_TIMEOUT_MS, intervalMs = RECEIPT_POLL_MS }: { timeoutMs?: number; intervalMs?: number } = {}
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) return receipt;
    } catch (error) {
      console.warn("Receipt lookup failed, retrying", error);
    }
    if (Date.now() + intervalMs > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/*
 * Sends a staking transaction on Polygon and reports its outcome:
 * - a refused network switch or a failed send shows an error toast and calls onError
 * - once sent, a pending toast shows and onTransact is called
 * - the receipt then decides between a success toast and a reverted toast, followed by onFinished, once
 * - no receipt within RECEIPT_TIMEOUT_MS shows an error toast with the hash and calls onError
 */
export default async function initiateTransaction(
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

  // Every staking contract these helpers call is on Polygon. The wallet is asked to switch first, and the
  // chain is passed to the send so viem refuses to sign if the wallet is still on another network.
  try {
    await switchToStakingChain(signer);
  } catch (error: any) {
    console.log(error);
    generateErrorToast(transactionDetails, "Switch your wallet to Polygon to continue.");
    onError();
    return;
  }

  let gasPrice: bigint;
  try {
    gasPrice = BigInt(await provider.send("eth_gasPrice", []));
  } catch (error: any) {
    console.log(error);
    generateErrorToast(transactionDetails, "Could not read the Polygon gas price. Try again in a moment.");
    onError();
    return;
  }

  // A legacy gas price rather than EIP-1559 fields: Polygon accepts both, and a legacy fee does not
  // depend on the wallet reporting a base fee, which some wallets and networks do not.
  const transactionParameters = {
    chain: STAKING_CHAIN,
    to: to, // Required except during contract publications.
    from: selectedWalletAddress, // must match user's active address.
    data: data, // Optional, but used for defining smart contract creation and interaction.
    gasPrice,
  };

  // trigger UI state changes
  onConfirm();

  let txHash: string;
  try {
    txHash = await signer.sendTransaction(transactionParameters);
  } catch (error: any) {
    console.log(error);
    generateErrorToast(transactionDetails, error.message);
    onError();
    return;
  }

  // trigger UI state changes
  onTransact();
  generatePendingToast(transactionDetails, txHash);

  const receipt = await waitForReceipt(txHash);
  if (!receipt) {
    generateErrorToast(
      transactionDetails,
      "The transaction has not confirmed after 5 minutes. Check it on Polygonscan before trying again.",
      txHash
    );
    onError();
    return;
  }

  if (receipt.status === 1) {
    generateSuccessToast(transactionDetails, txHash);
  } else {
    generateErrorToast(transactionDetails, "Transaction was reverted.", txHash);
  }
  onFinished();
}
