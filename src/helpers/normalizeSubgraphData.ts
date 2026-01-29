type RawData = {
    id: string;
    pools: any[];
    poolSnapshots: any[];
    quarterYearLiquidityData: any[];
    quarterYearVolumeData: any[];
};

type GroupedPool = {
    id: string;
    pool: any[];
    poolSnapshots: any[];
    quarterYearLiquidityData: any[];
    quarterYearVolumeData: any[];
};

export function groupByPoolId(raw: RawData): GroupedPool[] {
    const map = new Map<string, GroupedPool>();

    // Create groups from pools list (6 pools)
    for (const pool of raw.pools ?? []) {
        const poolId = (pool?.id ?? "").toLowerCase();
        if (!poolId) continue;

        map.set(poolId, {
            id: poolId,
            pool: pool,
            poolSnapshots: [],
            quarterYearLiquidityData: [],
            quarterYearVolumeData: [],
        });
    }


    const attachByPoolAddressAddress = (arr: any[] | undefined, key: keyof Omit<GroupedPool, "id">) => {
        for (const item of arr ?? []) {
            // THIS is the pool id for day data:
            let id;

            if (item?.pairAddress) {
                id = (item?.pairAddress ?? "").toLowerCase();
            } else {
                id = (item?.pool.id ?? "").toLowerCase();
            }

            if (!id) continue;

            const group = map.get(id);
            if (!group) continue; // ignore data for pools you didn't request

            group[key].push(item);
        }
    };

    // 2️⃣ Attach datasets
    attachByPoolAddressAddress(raw.poolSnapshots, "poolSnapshots");
    attachByPoolAddressAddress(raw.quarterYearLiquidityData, "quarterYearLiquidityData");
    attachByPoolAddressAddress(raw.quarterYearVolumeData, "quarterYearVolumeData");//not using for balancer/quickswap pools

    return Array.from(map.values());
}
