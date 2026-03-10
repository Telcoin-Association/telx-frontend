type RawData = {
    id: string;
    pools: any[];
    poolSnapshots: any[];
    threeMonthLiquidityData: any[];
};

type GroupedPool = {
    id: string;
    pool: any[];
    poolSnapshots: any[];
    threeMonthLiquidityData: any[];
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
            threeMonthLiquidityData: [],
        });
    }

    const attachByPoolAddressAddress = (arr: any[] | undefined, key: keyof Omit<GroupedPool, "id">) => {
        for (const item of arr ?? []) {
            // THIS is the pool id for day data:
            let id;

            if (item?.poolAddress) {
                id = (item?.poolAddress ?? "").toLowerCase();
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
    attachByPoolAddressAddress(raw.threeMonthLiquidityData, "threeMonthLiquidityData");

    return Array.from(map.values());
}
