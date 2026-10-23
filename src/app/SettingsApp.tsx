import { QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "../components/ui/Tooltip";
import { AboutCommand } from "../features/about/AboutWindow";
import { AppMenu } from "../features/menu/AppMenu";
import { Notifications } from "../features/notify/Notifications";
import { SettingsEffects } from "../features/settings/SettingsEffects";
import { SettingsCommand, SettingsWindow } from "../features/settings/SettingsWindow";
import { UpdateCommands, UpdateNotice } from "../features/update/UpdateNotice";
import { currentPlatform } from "../lib/platform";
import { useShowWhenRendered } from "../lib/windowChrome";
import { queryClient } from "./App";

/** The settings window: no repository, just the settings. */
export function SettingsApp() {
  useShowWhenRendered();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SettingsEffects />
        {/* The macOS menu bar follows the focused window; elsewhere the
            settings window has no menu bar of its own. */}
        {currentPlatform() === "macos" && <AppMenu />}
        <SettingsCommand />
        <AboutCommand />
        <SettingsWindow />
        <UpdateCommands />
        <Notifications>
          <UpdateNotice />
        </Notifications>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
