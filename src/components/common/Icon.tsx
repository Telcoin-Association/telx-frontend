import React, { SetStateAction } from "react";

export default function Icon({
  name,
  className,
  onClick,
  onLoad,
}: {
  name: string;
  className?: string;
  onClick?: SetStateAction<any>;
  onLoad?: () => void;
}) {
  React.useEffect(() => {
    if (onLoad) {
      onLoad();
    }
  }, [onLoad]);

  return (
    <i className={["material-symbols-outlined", className].join(" ")} onClick={onClick}>
      {name}
    </i>
  );
}
