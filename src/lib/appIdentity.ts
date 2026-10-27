import devIcon from "../../src-tauri/icons/dev/128x128@2x.png";
import releaseIcon from "../../src-tauri/icons/128x128@2x.png";

/** Set by the Tauri launcher for dev, including `tauri dev --release`. */
export const isDevelopmentApp = import.meta.env.VITE_GARAM_DEV === "true";
export const appNameKey = isDevelopmentApp ? "appNameDev" : "appName";
export const appIconUrl = isDevelopmentApp ? devIcon : releaseIcon;
