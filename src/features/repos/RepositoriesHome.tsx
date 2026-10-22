import { useCommand } from "../../lib/commands";

import { DropOverlay } from "./DropOverlay";
import { EmptyState } from "./EmptyState";
import { RepoDialogs } from "./dialogs/RepoDialogs";
import { useRepositories } from "./api";
import { useFolderDrop } from "./useFolderDrop";
import { Workspace } from "./Workspace";
import { useRepoDialog } from "./dialogStore";

/** Shown once git is available: empty state or the workspace. */
export function RepositoriesHome({ gitVersion }: { gitVersion: string }) {
  const repositories = useRepositories();
  const dragging = useFolderDrop();
  const openDialog = useRepoDialog((s) => s.open);
  useCommand("repo.add", () => openDialog({ kind: "add" }));
  useCommand("repo.create", () => openDialog({ kind: "create" }));
  useCommand("repo.clone", () => openDialog({ kind: "clone" }));

  // The list is local and fast; render nothing for the brief first load.
  if (!repositories.data) return null;
  const { repositories: list, selected } = repositories.data;

  return (
    <>
      {list.length === 0 ? (
        <EmptyState gitVersion={gitVersion} />
      ) : (
        <Workspace repositories={list} selected={selected} />
      )}
      <RepoDialogs />
      <DropOverlay visible={dragging} />
    </>
  );
}
