import React from "react";
import MoonLoader from "react-spinners/MoonLoader";

interface LoadingAnimationProps {
  theme?: "light" | "dark" | "extra-light";
  message?: string;
  size?: number;
  padding?: number;
  className?: string;
}

export { default as ReactLoader } from "react-loading";

export function _Loader({
  size,
  className,
  theme,
}: {
  size: number;
  className?: string;
  theme?: "light" | "dark" | "extra-light";
}) {
  let textColor;
  switch (theme) {
    case "light":
      textColor = "#14C8FF";
      break;
    case "dark":
      textColor = "#9298b5";
      break;
    case "extra-light":
      textColor = "#ffff";
      break;
    default:
      textColor = "#14C8FF";
  }
  return (
    <MoonLoader
      className={["text-5xl icon", className].join(" ")}
      color={textColor}
      loading={true}
      size={size}
      aria-label="Loading Spinner"
      data-testid="loader"
    />
  );
}

const LoadingAnimation = (props: LoadingAnimationProps) => {
  const { theme = "light", message, size = 88, className } = props; // padding defaults to 88
  return (
    <div
      className={[
        "flex-grow grid place-items-center w-full h-full",
        className,
      ].join(" ")}
    >
      <div className="flex flex-col items-center">
        <_Loader size={size} theme={theme} />
        {message && (
          <p
            className={`mt-2 font-base ${
              theme === "extra-light" ? "text-white-100" : "text-primary"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

export default LoadingAnimation;
