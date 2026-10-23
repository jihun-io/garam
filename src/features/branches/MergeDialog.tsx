import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { toAppError, type AppError, type Branch, type MergeOutcome } from "../../ipc";
import { runCommand } from "../../lib/commands";
import { useMergePreview } from "./api";
import styles from "./branches.module.css";
import { ConflictPreview } from "./ConflictPreview";

/** Picks a branch (unless given) and merges it into the current branch. */
export function MergeDialog({
  repo,
  current,
  branches,
  initial,
  onMerge,
  onClose,
}: {
  repo: string;
  current: string;
  branches: Branch[];
  initial?: Branch;
  /** `autostash` sets uncommitted changes aside for the merge. */
  onMerge: (branch: string, autostash: boolean) => Promise<MergeOutcome>;
  onClose: () => void;
}) {
  const { t } = useTranslation(["branches", "common"]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(initial?.name ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const preview = useMergePreview(repo, chosen);

  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return branches.filter((b) => !b.isHead && (!q || b.name.toLocaleLowerCase().includes(q)));
  }, [branches, query]);

  const submit = async (autostash = false) => {
    if (!chosen || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onMerge(chosen, autostash);
      onClose();
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  const count = preview.data?.commits;
  const conflicts = preview.data?.conflicts;
  // The ways out of a merge that stopped: resolve what it left, or set
  // the changes it would overwrite aside and go again.
  const errorAction =
    error?.kind === "merge_conflict"
      ? {
          label: t("common:fix.resolveConflicts"),
          run: () => {
            onClose();
            runCommand("view.changes");
          },
        }
      : error?.kind === "local_changes_would_be_overwritten"
        ? { label: t("common:fix.stashAndRetry"), run: () => void submit(true) }
        : undefined;
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("merge.title", { branch: current })}
      onSubmit={() => void submit()}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!chosen || busy || count === 0}>
            {!chosen
              ? t("merge.title", { branch: current })
              : conflicts && conflicts.length > 0
                ? t("merge.submitConflicts")
                : t("merge.submit", { from: chosen, into: current })}
          </Button>
        </>
      }
    >
      {!initial && (
        <>
          <p>{t("merge.choose", { branch: current })}</p>
          <input
            type="search"
            className={styles.search}
            placeholder={t("picker.search")}
            aria-label={t("picker.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <ul className={styles.mergeList} role="listbox" aria-label={t("picker.local")}>
            {candidates.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={b.name === chosen}
                  className={styles.mergeItem}
                  onClick={() => setChosen(b.name)}
                >
                  {b.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {chosen && count !== undefined && (
        <p className={styles.preview}>
          {count === 0
            ? t("merge.upToDate", { from: chosen, into: current })
            : t("merge.preview", { count, from: chosen, into: current })}
        </p>
      )}
      {chosen && count !== undefined && count > 0 && conflicts !== undefined && (
        <ConflictPreview conflicts={conflicts} />
      )}
      {error && <ErrorMessage error={error} action={errorAction} />}
    </FormDialog>
  );
}
