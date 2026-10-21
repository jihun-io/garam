import type { Branch } from "../../ipc";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useBranchActions } from "./api";
import { useBranchDialog } from "./branchDialogStore";
import { BranchDialogs } from "./BranchDialogs";
import { BranchPicker } from "./BranchPicker";

/** Branch picker plus its dialogs, for the toolbar. */
export function BranchControls({ repo }: { repo: string }) {
  const status = useStatus(repo);
  const { switchTo } = useBranchActions(repo);
  const openDialog = useBranchDialog((s) => s.open);
  const showError = useNotify((s) => s.showError);
  if (!status.data) return null;
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
