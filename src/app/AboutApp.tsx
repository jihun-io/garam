import { QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "../components/ui/Tooltip";
import { AboutCommand, AboutWindow } from "../features/about/AboutWindow";
import { AppMenu } from "../features/menu/AppMenu";
import { Notifications } from "../features/notify/Notifications";
import { SettingsEffects } from "../features/settings/SettingsEffects";
import { SettingsCommand } from "../features/settings/SettingsWindow";
import { UpdateCommands, UpdateNotice } from "../features/update/UpdateNotice";
import { currentPlatform } from "../lib/platform";
import { useShowWhenRendered } from "../lib/windowChrome";
import { queryClient } from "./App";

/** The About window: no repository, just the app's name and version. */
export function AboutApp() {
  useShowWhenRendered();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SettingsEffects />
        {/* Like the settings window: the macOS menu bar follows the focused
            window; elsewhere the About window has no menu bar of its own. */}
        {currentPlatform() === "macos" && <AppMenu />}
        <SettingsCommand />
        <AboutCommand />
        <AboutWindow />
        <UpdateCommands />
        <Notifications>
          <UpdateNotice />
        </Notifications>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
