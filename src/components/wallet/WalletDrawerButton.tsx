import React from "react";
import WalletLogo from "../../public/icons/wallet.svg";

interface WalletDrawerButtonProps {
  setWalletIsOpen: any;
  walletIsOpen: boolean;
}

export default function WalletDrawerButton(props: WalletDrawerButtonProps) {
  const { setWalletIsOpen, walletIsOpen } = props;
  return (
    <div className="wallet-drawer-button">
      <button onClick={() => setWalletIsOpen(!walletIsOpen)}>
        <WalletLogo />
      </button>
    </div>
  );
}
