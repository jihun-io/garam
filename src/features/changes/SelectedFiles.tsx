import { useTranslation } from "react-i18next";

import { EmptyMessage } from "../../components/EmptyMessage";
import { Button } from "../../components/ui/Button";
import type { FileChange } from "../../ipc";
import styles from "./ChangesView.module.css";
import { checkState } from "./fileState";

/** In place of a diff while several files are selected: what to do with them. */
export function SelectedFiles({
  files,
  onToggle,
  onStash,
  onDiscard,
}: {
  files: FileChange[];
  onToggle: (files: FileChange[]) => void;
  onStash: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation("changes");
  const toggleable = files.filter((f) => f.staged !== "conflicted");
  const allIncluded = toggleable.every((f) => checkState(f) === "checked");
  const conflicted = toggleable.length < files.length;
  return (
    <EmptyMessage
      icon="files"
      title={t("selection.title", { count: files.length })}
      body={conflicted ? t("selection.conflicted") : undefined}
    >
      <div className={styles.selectionActions}>
        <Button disabled={toggleable.length === 0} onClick={() => onToggle(toggleable)}>
          {allIncluded ? t("selection.exclude") : t("selection.include")}
        </Button>
        <Button icon="stash" disabled={conflicted} onClick={onStash}>
          {t("selection.stash")}
        </Button>
        <Button variant="danger" icon="discard" onClick={onDiscard}>
          {t("selection.discard")}
        </Button>
      </div>
    </EmptyMessage>
  );
}
