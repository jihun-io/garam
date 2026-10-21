import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
    </QueryClientProvider>
  );
}
