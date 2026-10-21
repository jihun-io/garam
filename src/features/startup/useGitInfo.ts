import { useQuery } from "@tanstack/react-query";

import { commands, unwrap } from "../../ipc";

export function useGitInfo() {
  return useQuery({
    queryKey: ["git", "info"],
    queryFn: () => unwrap(commands.gitInfo()),
    retry: false,
    staleTime: Infinity,
  });
}
