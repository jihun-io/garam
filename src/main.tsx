import React from "react";
import ReactDOM from "react-dom/client";

import "./i18n";
import "./styles/global.css";
import { App } from "./app/App";
import { initTheme } from "./lib/theme";

// Before the first render, so the first frame already has the right colors.
initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
