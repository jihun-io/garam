import { DropOverlay } from "./DropOverlay";
import { EmptyState } from "./EmptyState";
import { RepoDialogs } from "./dialogs/RepoDialogs";
import { useRepositories } from "./api";
import { useFolderDrop } from "./useFolderDrop";
import { Workspace } from "./Workspace";

/** Shown once git is available: empty state or the workspace. */
export function RepositoriesHome({ gitVersion }: { gitVersion: string }) {
  const repositories = useRepositories();
  const dragging = useFolderDrop();

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
