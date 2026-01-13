export function shortenAddress(address: string | undefined) {
  const numCharacters = 4;
  if (!address || typeof address !== "string") {
    return "";
  }
  const length = address.length;
  return `${address.substring(0, numCharacters)}...${address.substring(length - numCharacters)}`;
}
