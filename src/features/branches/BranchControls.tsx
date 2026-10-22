import { ToolbarPlaceholder } from "../../components/ui/ToolbarButton";
import type { Branch } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useBranchActions, useBranches } from "./api";
import { useBranchDialog } from "./branchDialogStore";
import { BranchDialogs } from "./BranchDialogs";
import { BranchPicker } from "./BranchPicker";

/** Branch picker plus its dialogs, for the toolbar. */
export function BranchControls({ repo }: { repo: string }) {
  const status = useStatus(repo);
  const { switchTo } = useBranchActions(repo);
  const openDialog = useBranchDialog((s) => s.open);
  const showError = useNotify((s) => s.showError);
  const branches = useBranches(repo);
  const head = branches.data?.find((b) => b.kind === "local" && b.isHead);
  useCommand("branch.create", () => openDialog({ kind: "create" }), !!status.data);
  useCommand("branch.rename", () => head && openDialog({ kind: "rename", branch: head }), !!head);
  useCommand("branch.merge", () => openDialog({ kind: "merge" }), !!head);
  if (status.isError) return null;
  if (!status.data) return <ToolbarPlaceholder icon="branch" />;
  const { branch, files } = status.data;

  // Only ask what to do with changes when there are any.
  const choose = (target: Branch) => {
    if (files.length > 0) {
      openDialog({ kind: "switch", target });
    } else {
      switchTo.mutate(
        { target, mode: "bring_changes", current: branch.head },
        { onError: showError },
      );
    }
  };

  return (
    <>
      <BranchPicker repo={repo} status={branch} onChoose={choose} />
      <BranchDialogs repo={repo} status={branch} />
    </>
  );
}
