import { useTranslation } from "react-i18next";

import type { BranchStatus } from "../../ipc";
import { shortHash } from "../../lib/hash";
import { useNotify } from "../notify/notifyStore";
import { useBranchActions, useBranches } from "./api";
import { useBranchDialog } from "./branchDialogStore";
import { BranchNameDialog } from "./BranchNameDialog";
import { DeleteBranchDialog } from "./DeleteBranchDialog";
import { MergeDialog } from "./MergeDialog";
import { SwitchDialog } from "./SwitchDialog";

/** Renders whichever branch dialog is open for `repo`. */
export function BranchDialogs({ repo, status }: { repo: string; status: BranchStatus }) {
  const { t } = useTranslation("branches");
  const { dialog, close } = useBranchDialog();
  const branches = useBranches(repo);
  const actions = useBranchActions(repo);
  const showInfo = useNotify((s) => s.showInfo);
  const current = status.head;

  if (!dialog) return null;
  switch (dialog.kind) {
    case "create":
      return (
        <BranchNameDialog
          title={t("create.title")}
          label={t("create.name")}
          submitLabel={t("create.submit")}
          note={
            dialog.from
              ? t("create.fromCommit", {
                  hash: shortHash(dialog.from.oid),
                  summary: dialog.from.summary,
                })
              : t("create.from", { branch: current ?? t("picker.detached") })
          }
          onSubmit={(name) => actions.create.mutateAsync({ name, start: dialog.from?.oid })}
          onClose={close}
        />
      );
    case "rename":
      return (
        <BranchNameDialog
          title={t("rename.title", { branch: dialog.branch.name })}
          label={t("rename.name")}
          submitLabel={t("rename.submit")}
          initialName={dialog.branch.name}
          onSubmit={(name) => actions.rename.mutateAsync({ from: dialog.branch.name, to: name })}
          onClose={close}
        />
      );
    case "delete":
      return (
        <DeleteBranchDialog
          branch={dialog.branch}
          onDelete={(force) => actions.remove.mutateAsync({ name: dialog.branch.name, force })}
          onClose={close}
        />
      );
    case "switch":
      return (
        <SwitchDialog
          target={dialog.target}
          current={current}
          onSwitch={(mode) =>
            actions.switchTo.mutateAsync({ target: dialog.target, mode, current })
          }
          onClose={close}
        />
      );
    case "merge":
      if (!current) return null;
      return (
        <MergeDialog
          repo={repo}
          current={current}
          branches={branches.data ?? []}
          initial={dialog.branch}
          onMerge={async (from) => {
            const outcome = await actions.merge.mutateAsync(from);
            showInfo(
              outcome === "up_to_date"
                ? t("merge.resultUpToDate", { into: current })
                : t("merge.resultMerged", { from, into: current }),
            );
            return outcome;
          }}
          onClose={close}
        />
      );
  }
}
