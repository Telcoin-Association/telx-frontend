import { BASE_RPC_URL, ETHEREUM_RPC_URL, POLYGON_RPC_URL } from "@/lib/contracts";
import { createPublicClient, http } from "viem";
import { base, mainnet, polygon } from "viem/chains";

export function decodePositionInfo(value: bigint) {
    return {
        getTickUpper: () => {
            const raw = Number((value >> 32n) & 0xffffffn);
            return raw >= 0x800000 ? raw - 0x1000000 : raw;
        },
        getTickLower: () => {
            const raw = Number((value >> 8n) & 0xffffffn);
            return raw >= 0x800000 ? raw - 0x1000000 : raw;
        },
        hasSubscriber: () => (value & 0xffn) !== 0n,
    };
}

export function formatSqrtPriceX96(sqrtPriceX96: bigint | string, token0Decimals: number, token1Decimals: number) {
    const sqrt = Number(sqrtPriceX96) / 2 ** 96;
    const price = (sqrt ** 2 * 10 ** token0Decimals) / 10 ** token1Decimals;
    return price;
}

export const publicClientEthereum = createPublicClient({
    chain: mainnet,
    transport: http(ETHEREUM_RPC_URL, {
        fetchOptions: {
            headers: {
                'Origin': process.env.NEXT_PUBLIC_ORIGIN ? `${process.env.NEXT_PUBLIC_ORIGIN}` : "http://localhost:3000/"
            }
        }
    })
});

export const publicClientPolygon = createPublicClient({
    chain: polygon,
    transport: http(POLYGON_RPC_URL, {
        fetchOptions: {
            headers: {
                'Origin': process.env.NEXT_PUBLIC_ORIGIN ? `${process.env.NEXT_PUBLIC_ORIGIN}` : "http://localhost:3000/"
            }
        }
    })
});

export const publicClientBase = createPublicClient({
    chain: base,
    transport: http(BASE_RPC_URL, {
        fetchOptions: {
            headers: {
                'Origin': process.env.NEXT_PUBLIC_ORIGIN ? `${process.env.NEXT_PUBLIC_ORIGIN}` : "http://localhost:3000/"
            }
        }
    })
});

// ----------------------
// Minimal ABIs
// ----------------------
export const positionManagerAbi = [
    {
        type: "function",
        name: "positionInfo",
        inputs: [{ type: "uint256", name: "tokenId" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getPositionLiquidity",
        inputs: [{ type: "uint256", name: "tokenId" }],
        outputs: [{ type: "uint128" }],
        stateMutability: "view",
    },
] as const;

export const positionRegistryAbi = [
    {
        type: "function",
        name: "isTokenSubscribed",
        inputs: [{ type: "uint256", name: "tokenId" }],
        outputs: [{ type: "bool" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getAmountsForLiquidity",
        inputs: [
            { type: "bytes32", name: "poolId" },
            { type: "uint128", name: "liquidity" },
            { type: "int24", name: "tickLower" },
            { type: "int24", name: "tickUpper" },
        ],
        outputs: [
            { type: "uint256", name: "amount0" },
            { type: "uint256", name: "amount1" },
            { type: "uint160", name: "sqrtPriceX96" },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "unclaimedRewards",
        inputs: [{ type: "address", name: "account" }],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
    },
    {
        inputs: [],
        name: "claim",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    }
] as const;