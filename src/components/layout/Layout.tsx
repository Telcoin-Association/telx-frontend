"use client";

import React from "react";
import { ToastContainer } from "react-toastify";
import { SkrimProvider } from "../providers/SkrimProvider";
import { Provider } from "react-redux";
import { store } from "@/redux/store";

export default function Layout(props: any) {
  const { children } = props;

  return (
    <div className="">
      <SkrimProvider>
        <Provider store={store}>{children}</Provider>
      </SkrimProvider>
      <ToastContainer
        position="bottom-left"
        pauseOnHover={false}
        autoClose={15000}
        pauseOnFocusLoss={false}
      />
    </div>
  );
}
