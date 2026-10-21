import { useRepoDialog } from "../dialogStore";
import { AddRepositoryDialog } from "./AddRepositoryDialog";
import { CloneRepositoryDialog } from "./CloneRepositoryDialog";
import { CreateRepositoryDialog } from "./CreateRepositoryDialog";

/** Renders whichever repository dialog is open. Mount once per screen. */
export function RepoDialogs() {
  const { dialog, close } = useRepoDialog();
  if (!dialog) return null;
  switch (dialog.kind) {
    case "add":
      return (
        <AddRepositoryDialog
          // Remount when re-opened from a new drop with different input.
          key={dialog.path ?? ""}
          initialPath={dialog.path}
          initialError={dialog.error}
          onClose={close}
        />
      );
    case "create":
      return <CreateRepositoryDialog onClose={close} />;
    case "clone":
      return <CloneRepositoryDialog onClose={close} />;
  }
}
