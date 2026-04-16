import { stringNumbertoUSD } from "@/helpers/returnNumber";

function formatDateToISO(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${year}-${month}-${day}`;
}

export function getChartData(contractData: any) {
  let totalLiquidity;
  let dailyVolume;
  let dailyFees;
  let weights = [];
  let labels = [];
  let volumeWeights = [];
  let volumeLabels = [];
  let feeWeights = [];
  let feeLabels = [];

  if (contractData && contractData.liquidityChartData) {
    switch (contractData.protocol) {
      case "quickswap":
        totalLiquidity = stringNumbertoUSD(parseFloat(contractData.totalLiquidity));
        dailyVolume = stringNumbertoUSD(contractData.dailyVolumeUSD);
        dailyFees = stringNumbertoUSD(contractData.fees24hr);
        weights = contractData.liquidityChartData.map((data: any) => parseFloat(data.reserveUSD)).reverse();
        labels = contractData.liquidityChartData.map((data: any) => formatDateToISO(new Date(data.date * 1000)));
        volumeWeights = contractData.volumeChartData.map((data: any) => parseFloat(data.dailyVolumeUSD)).reverse();
        feeWeights = contractData.liquidityChartData.map((data: any) => parseFloat(data.dailyVolumeUSD) * 0.003).reverse();
        volumeLabels = contractData.volumeChartData.map((data: any) => formatDateToISO(new Date(data.date * 1000)));
        feeLabels = contractData.liquidityChartData.map((data: any) => formatDateToISO(new Date(data.date * 1000)));
        break;
      case "balancer":
        totalLiquidity = stringNumbertoUSD(parseFloat(contractData.totalLiquidity));
        dailyVolume = stringNumbertoUSD(contractData.dailyVolumeUSD);
        dailyFees = stringNumbertoUSD(contractData.fees24hr);
        weights = contractData.liquidityChartData.map((data: any) => parseFloat(data.liquidity));
        labels = contractData.liquidityChartData.map((data: any) => formatDateToISO(new Date(data.timestamp * 1000))).reverse();
        volumeWeights = contractData.volumeChartData.map((data: any) => parseFloat(data.swapVolume));
        volumeLabels = contractData.volumeChartData.map((data: any) => formatDateToISO(new Date(data.timestamp * 1000))).reverse();
        feeWeights = contractData.volumeChartData.map((data: any) => parseFloat(data.swapFees));
        feeLabels = volumeLabels; 
        break;
      case "dfx":
        totalLiquidity = stringNumbertoUSD(parseFloat(contractData.totalLiquidity));
        dailyVolume = stringNumbertoUSD(contractData.dailyVolumeUSD);
        dailyFees = 0;
        weights = contractData.liquidityChartData.map((data: any) => parseFloat(data.reserveUSD)).reverse();
        labels = contractData.liquidityChartData.map((data: any) => formatDateToISO(new Date(data.date * 1000)));
        volumeWeights = contractData.volumeChartData.map((data: any) => parseFloat(data.volumeUSD)).reverse();
        volumeLabels = contractData.volumeChartData.map((data: any) => formatDateToISO(new Date(data.date * 1000)));
        feeWeights = [];
        feeLabels = [];
        break;
      case "uniswap":
        totalLiquidity = stringNumbertoUSD(parseFloat(contractData.totalLiquidity));
        dailyVolume = stringNumbertoUSD(contractData.dailyVolumeUSD);
        dailyFees = stringNumbertoUSD(contractData.fees24hr);
        weights = contractData.liquidityChartData.map((data: any) => parseFloat(data.tvlUSD)).reverse();
        labels = contractData.liquidityChartData.map((data: any) => formatDateToISO(new Date(data.timestamp * 1000)));
        volumeWeights = contractData.volumeChartData.map((data: any) => parseFloat(data.volumeUSD)).reverse();
        feeWeights = contractData.volumeChartData.map((data: any) => parseFloat(data.feesUSD)).reverse();
        volumeLabels = contractData.volumeChartData.map((data: any) => formatDateToISO(new Date(data.timestamp * 1000)));
        feeLabels = contractData.volumeChartData.map((data: any) => formatDateToISO(new Date(data.timestamp * 1000)));
        break;
      default:
        break;
    }
  }

  return {
    totalLiquidity: totalLiquidity,
    dailyVolume: dailyVolume,
    dailyFees: dailyFees,
    liquidityWeights: weights,
    liquidityLabels: labels,
    volumeWeights: volumeWeights,
    volumeLabels: volumeLabels,
    feeWeights: feeWeights,
    feeLabels: feeLabels,
  };
}
