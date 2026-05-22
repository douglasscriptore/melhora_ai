import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Toolbar from "./Toolbar";
import { getCurrentWindow } from "@tauri-apps/api/window";

const root = document.getElementById("root") as HTMLElement;
const label = getCurrentWindow().label;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {label === "toolbar" ? <Toolbar /> : <App />}
  </React.StrictMode>,
);
