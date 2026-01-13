export default function formatNumberToCurrencyString(value: number) {
  const roundedAmount = Math.round(value * 100) / 100;
  const usdAmount = roundedAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
  });
  return `$${usdAmount}`;
}
