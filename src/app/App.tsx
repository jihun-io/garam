import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Notifications } from "../features/notify/Notifications";
import { StartupGate } from "../features/startup/StartupGate";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StartupGate />
      <Notifications />
    </QueryClientProvider>
  );
}
