
import { ethers } from "ethers";
import SINGLE_STAKING_ABI from "../../abis/staking_single_rewards.json";
import DUAL_STAKING_ABI from "../../abis/staking_dual_rewards.json";
import MULTI_STAKING_ABI from "../../abis/staking_multi_rewards.json";
import { provider } from "@/lib/ethersProvider";

export type ContractType = "single" | "double" | "multi";

export async function createStakingContract(
  type: ContractType,
  stakeAddress: string
) {
  let abi;

  switch (type) {
    case "single":
      abi = SINGLE_STAKING_ABI;
      break;
    case "double":
      abi = DUAL_STAKING_ABI;
      break;
    case "multi":
      abi = MULTI_STAKING_ABI;
      break;
    default:
      throw new Error(`Unsupported ContractType: ${type}`);
  }

  // Create ethers Contract instance
  return new ethers.Contract(stakeAddress, abi, provider);
}
