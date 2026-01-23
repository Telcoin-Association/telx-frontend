type RawData = {
    id: string;
    pairs: any[];
    pairDayDatas: any[];
    quarterYearLiquidityData: any[];
    quarterYearVolumeData: any[];
};

type GroupedPool = {
    id: string;
    pair: any[];
    pairDayDatas: any[];
    quarterYearLiquidityData: any[];
    quarterYearVolumeData: any[];
};

export function groupQuickSwapByPoolId(raw: RawData): GroupedPool[] {
    const map = new Map<string, GroupedPool>();

    // Create groups from pools list (6 pools)
    for (const pair of raw.pairs ?? []) {
        const poolId = (pair?.id ?? "").toLowerCase();
        if (!poolId) continue;

        map.set(poolId, {
            id: poolId,
            pair: pair,
            pairDayDatas: [],
            quarterYearLiquidityData: [],
            quarterYearVolumeData: [],
        });
    }


    const attachByPairAddress = (arr: any[] | undefined, key: keyof Omit<GroupedPool, "id">) => {
        for (const item of arr ?? []) {
            // ✅ THIS is the pool id for day data:
            const id = (item?.pairAddress ?? "").toLowerCase();
            if (!id) continue;

            const group = map.get(id);
            if (!group) continue; // ignore data for pools you didn't request

            group[key].push(item);
        }
    };

    // 2️⃣ Attach datasets
    attachByPairAddress(raw.pairDayDatas, "pairDayDatas");
    attachByPairAddress(raw.quarterYearLiquidityData, "quarterYearLiquidityData");
    attachByPairAddress(raw.quarterYearVolumeData, "quarterYearVolumeData");

    return Array.from(map.values());
}
