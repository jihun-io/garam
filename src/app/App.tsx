import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CredentialDialog } from "../features/credentials/CredentialDialog";
import { AppMenu } from "../features/menu/AppMenu";
import { HelpCommands } from "../features/menu/HelpCommands";
import { Notifications } from "../features/notify/Notifications";
import { StartupGate } from "../features/startup/StartupGate";
import { TooltipProvider } from "../components/ui/Tooltip";
import { WindowDragArea } from "../components/WindowDragArea";
import { SettingsEffects } from "../features/settings/SettingsEffects";
import { SettingsCommand } from "../features/settings/SettingsWindow";

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
        <AppMenu />
        <HelpCommands />
        <WindowDragArea />
        <StartupGate />
        <Notifications />
        <CredentialDialog />
        <SettingsCommand />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
