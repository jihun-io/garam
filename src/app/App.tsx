import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CredentialDialog } from "../features/credentials/CredentialDialog";
import { Notifications } from "../features/notify/Notifications";
import { StartupGate } from "../features/startup/StartupGate";
import { TooltipProvider } from "../components/ui/Tooltip";
import { WindowDragArea } from "../components/WindowDragArea";
import { SettingsDialog } from "../features/settings/SettingsDialog";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WindowDragArea />
        <StartupGate />
        <Notifications />
        <CredentialDialog />
        <SettingsDialog />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
