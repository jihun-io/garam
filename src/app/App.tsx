import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AboutCommand } from "../features/about/AboutWindow";
import { AccountsSync } from "../features/accounts/api";
import { SquashUndoDialog } from "../features/history/SquashUndo";
import { CredentialDialog } from "../features/credentials/CredentialDialog";
import { AppMenu } from "../features/menu/AppMenu";
import { HelpCommands } from "../features/menu/HelpCommands";
import { Notifications } from "../features/notify/Notifications";
import { StartupGate } from "../features/startup/StartupGate";
import { TooltipProvider } from "../components/ui/Tooltip";
import { WindowDragArea } from "../components/WindowDragArea";
import { SettingsEffects } from "../features/settings/SettingsEffects";
import { SettingsCommand } from "../features/settings/SettingsWindow";
import { UpdateCommands, UpdateNotice } from "../features/update/UpdateNotice";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SettingsEffects />
        <AccountsSync />
        <AppMenu />
        <HelpCommands />
        <WindowDragArea />
        <StartupGate />
        <UpdateCommands />
        <Notifications>
          <UpdateNotice />
        </Notifications>
        <CredentialDialog />
        <SquashUndoDialog />
        <SettingsCommand />
        <AboutCommand />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
