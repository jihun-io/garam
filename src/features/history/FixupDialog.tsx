import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Loading } from "../../components/ui/Loading";
import { commands, toAppError, unwrap, type CommitSummary, type Finding } from "../../ipc";
import { runCommand } from "../../lib/commands";
import { shortHash } from "../../lib/hash";
import { CommitCheckDialog } from "../changes/CommitCheckDialog";
import { useStatus } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useSettings } from "../settings/api";
import { useCommitActions } from "./api";
import styles from "./FixupDialog.module.css";

type Props = {
  repo: string;
  commit: CommitSummary;
  head: string;
  branch: string;
  onClose: () => void;
  onFixup: (oid: string) => void;
};

export function FixupDialog({ repo, commit, head, branch, onClose, onFixup }: Props) {
  const { t } = useTranslation("history");
  const { fixup } = useCommitActions(repo);
  const { showInfo, showError } = useNotify();
  const { commitChecks } = useSettings();
  const status = useStatus(repo);
  const [checking, setChecking] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  // Never silently replace a confirmed tree when the watcher fires or the
  // window gains focus. The engine rejects a stale tree; refresh is explicit.
  const preview = useQuery({
    queryKey: ["fixup-preview", repo, head, commit.oid],
    queryFn: () => unwrap(commands.commitFixupPreview(repo)),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const busy = fixup.isPending || checking || preview.isFetching;
  const ready = Boolean(preview.data?.paths.length) && !preview.error && !busy;
  const createFixup = () => {
    if (!preview.data) return;
    fixup.mutate(
      { oid: commit.oid, head, branch, tree: preview.data.tree },
      {
        onSuccess: (oid) => {
          onFixup(oid);
          showInfo(t("done.fixedUp"));
          onClose();
        },
        onError: (error) => {
          if (toAppError(error).kind === "fixup_incomplete") {
            onClose();
            runCommand("view.changes");
            showError(error);
          }
        },
      },
    );
  };
  const submit = async () => {
    if (!ready) return;
    if (!commitChecks) {
      createFixup();
      return;
    }
    setChecking(true);
    try {
      const result = await commands.commitCheck(repo);
      if (result.status === "ok" && result.data.length > 0) setFindings(result.data);
      else createFixup();
    } catch {
      // As with normal commits, an unavailable check does not block work.
      createFixup();
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <FormDialog
        open
        title={t("fixup.title")}
        description={`${shortHash(commit.oid)} · ${commit.summary}`}
        onOpenChange={(open) => !open && !busy && onClose()}
        onSubmit={() => void submit()}
        dismissible={!busy}
        footer={
          <>
            <Button onClick={onClose} disabled={busy} autoFocus>
              {t("fixup.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!ready}>
              {t("fixup.submit")}
            </Button>
          </>
        }
      >
        <p>{t("fixup.body")}</p>
        {preview.isPending ? (
          <Loading />
        ) : preview.error ? (
          <ErrorMessage error={toAppError(preview.error)} />
        ) : preview.data?.paths.length ? (
          <>
            <p>{t("fixup.files", { count: preview.data.paths.length })}</p>
            <ul className={styles.paths}>
              {preview.data.paths.slice(0, 100).map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
            {preview.data.paths.length > 100 && (
              <p>{t("fixup.more", { count: preview.data.paths.length - 100 })}</p>
            )}
          </>
        ) : (
          <p>{t("fixup.nothingStaged")}</p>
        )}
        <p>{t("fixup.recover")}</p>
        {fixup.error && <ErrorMessage error={toAppError(fixup.error)} />}
        {(fixup.error || preview.error) && (
          <Button
            disabled={busy}
            onClick={() => {
              fixup.reset();
              void preview.refetch();
            }}
          >
            {t("fixup.refresh")}
          </Button>
        )}
      </FormDialog>
      {findings && (
        <CommitCheckDialog
          repo={repo}
          findings={findings}
          canCommit={status.data?.files.some((f) => f.staged !== null) ?? false}
          submitLabel={t("fixup.submit")}
          submitAnywayLabel={t("fixup.submitAnyway")}
          onCommit={() => {
            setFindings(null);
            createFixup();
          }}
          onClose={() => setFindings(null)}
        />
      )}
    </>
  );
}
