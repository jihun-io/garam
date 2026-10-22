import React from "react";
import ReactDOM from "react-dom/client";

import "./i18n";
import "./styles/global.css";
import { App } from "./app/App";
import { initTheme } from "./lib/theme";
import { initWindowChrome } from "./lib/windowChrome";

// Before the first render, so the first frame already looks right.
initTheme();
initWindowChrome();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
