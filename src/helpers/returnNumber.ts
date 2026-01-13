export const stringNumbertoUSD = (stringNumber: number | null) => {
  if (stringNumber == null) return null;

  return parseFloat(stringNumber.toString())
    .toFixed(2)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const stringNumberToFixed = (stringNumber: number, toFixed: number) => {
  return parseFloat(stringNumber.toString())
    .toFixed(toFixed)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const stringNumbertoNoDecimal = (stringNumber: number) => {
  return parseFloat(stringNumber.toString())
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const numberToDecimal = (stringNumber: number, amountToFixed = 6) => {
  return parseFloat(stringNumber.toString()).toFixed(amountToFixed);
};

export const numberToDecimalFixed = (stringNumber: number, amountToFixed = 6) => {
  return parseFloat(stringNumber.toString())
    .toFixed(amountToFixed)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const truncateAddress = (address: string) => {
  const beginningLength = 8;
  const endLength = 8;
  const beginningAddress = address.substring(0, beginningLength);
  const endAddress = address.substring(address.length - endLength, address.length);
  return `${beginningAddress}...${endAddress}`;
};
