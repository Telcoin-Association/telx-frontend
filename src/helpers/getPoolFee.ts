export function getPoolFee(poolAddress: string): string {
    const lowFeeAddress = "0xfd56605f7f4620ab44dfc0860d70b9bd1d1f648a5a74558491b39e816a10b99a".toLowerCase();
  
    return poolAddress.toLowerCase() === lowFeeAddress ? "0.05%" : "0.3%";
  }
  