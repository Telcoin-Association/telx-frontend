import { lightTheme, Theme } from "@rainbow-me/rainbowkit";
import merge from "lodash.merge";

const theme = merge(lightTheme(), {
  colors: {
    accentColor: "linear-gradient(255.96deg, #37aeff 0%, #5533ff 100%)",
    accentColorForeground: "white",
    actionButtonBorder: "white",
    actionButtonBorderMobile: "white",
    closeButton: "rgba(60, 66, 66, 0.8)",
    closeButtonBackground: "rgba(0, 0, 0, 0.06)",
    connectButtonBackground: "#FFF",
    connectButtonBackgroundError: "#FF494A",
    connectButtonInnerBackground: "linear-gradient(0deg, rgba(0, 0, 0, 0.03), rgba(0, 0, 0, 0.06))",
    connectButtonText: "#25292E",
    connectButtonTextError: "#FFF",
    connectionIndicator: "#30E000",
    downloadBottomCardBackground: "linear-gradient(126deg, rgba(255, 255, 255, 0) 9.49%, rgba(171, 171, 171, 0.04) 71.04%), #FFFFFF",
    downloadTopCardBackground: "linear-gradient(126deg, rgba(171, 171, 171, 0.2) 9.49%, rgba(255, 255, 255, 0) 71.04%), #FFFFFF",
    error: "#FF494A",
    generalBorder: "rgba(0, 0, 0, 0.06)",
    generalBorderDim: "rgba(0, 0, 0, 0.03)",
    menuItemBackground: "rgba(60, 66, 66, 0.1)",
    modalBackdrop: "rgba(0, 0, 0, 0.3)",
    modalBackground: "#FFF",
    modalBorder: "transparent",
    modalText: "#25292E",
    modalTextDim: "rgba(60, 66, 66, 0.3)",
    modalTextSecondary: "rgba(60, 66, 66, 0.6)",
    profileAction: "#FFF",
    profileActionHover: "rgba(255, 255, 255, 0.5)",
    profileForeground: "rgba(60, 66, 66, 0.06)",
    selectedOptionBorder: "rgba(60, 66, 66, 0.1)",
    standby: "#FFD641",
  },
  shadows: {
    connectButton: "0px 4px 12px rgba(0, 0, 0, 0.1)",
    dialog: "0px 8px 32px rgba(0, 0, 0, 0.32)",
    profileDetailsAction: "0px 2px 6px rgba(37, 41, 46, 0.04)",
    selectedOption: "0px 2px 6px rgba(0, 0, 0, 0.24)",
    selectedWallet: "0px 2px 6px rgba(0, 0, 0, 0.12)",
    walletLogo: "0px 2px 16px rgba(0, 0, 0, 0.16)",
  },
  radii: {
    actionButton: "20px",
    connectButton: "4px",
    menuButton: "12px",
    modal: "12px",
    modalMobile: "12px",
  },
  blurs: {
    modalOverlay: "blur(0px);",
  },
  fonts: {
    body: "hero-new, sans-serif",
  },
}) as Theme;

export default theme;
