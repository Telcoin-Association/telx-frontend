import React from "react";
import { useSkrimContext } from "../providers/SkrimProvider";
import { Menu as MenuIcon } from "@transferwise/icons";
import { useWindowDimensions } from "@/hooks";
import MobileMenuDrawer from "./MobileMenuDrawer";

export default function MobileMenuDrawerToggle({ path }: { path: string }) {
  const { width: windowWidth } = useWindowDimensions();
  const { set } = useSkrimContext();

  const handleToggleWalletDrawer = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (windowWidth < 1024) {
      set(<MobileMenuDrawer path={path} />);
    }
  };

  return (
    <div
      onClick={handleToggleWalletDrawer}
      className="mobile-menu-drawer-toggle lg:hidden text-white h-8 flex items-center justify-center"
    >
      <MenuIcon size={24} />
    </div>
  );
}
