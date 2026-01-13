export const formatProtocol = (protocol: string) => {
  let formattedProtocol;
  switch (protocol) {
    case "quickswap":
      formattedProtocol = "Quickswap";
      break;

    case "balancer":
      formattedProtocol = "Balancer";
      break;

    case "dfx":
      formattedProtocol = "DFX";
      break;

    case "uniswap":
      formattedProtocol = "Uniswap";
      break;

    default:
      break;
  }
  return formattedProtocol;
};
