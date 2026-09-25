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