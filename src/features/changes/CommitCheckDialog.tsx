import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import {
  commands,
  toAppError,
  unwrap,
  type AppError,
  type FileChange,
  type Finding,
} from "../../ipc";
import { useChangeActions, useStatus } from "./api";
import styles from "./CommitCheckDialog.module.css";
import {
  checkRows,
  GITHUB_LIMIT_MIB,
  LFS_URL,
  rowKey,
  rowPaths,
  type CheckRow,
  type SecretHit,
} from "./commitCheck";
import { splitPath } from "./fileState";

const GROUPS: { kind: CheckRow["kind"]; icon: IconName }[] = [
  { kind: "secret", icon: "secret" },
  { kind: "large_file", icon: "largeFile" },
  { kind: "ignorable", icon: "ignorable" },
];

/**
 * What the safety checks found in the commit, with a fix for each. Fixing
 * checks again; once nothing is left, the main button commits as planned.
 */
export function CommitCheckDialog({
  repo,
  findings: initial,
  canCommit,
  amendId,
  submitLabel,
  submitAnywayLabel,
  onCommit,
  onClose,
}: {
  repo: string;
  findings: Finding[];
  /** Something is still staged (or the commit amends). */
  canCommit: boolean;
  amendId?: string;
  submitLabel?: string;
  submitAnywayLabel?: string;
  onCommit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("changes");
  const [findings, setFindings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError>();
  const { unstage, ignore } = useChangeActions(repo, amendId);
  const status = useStatus(repo, amendId);
  const rows = checkRows(findings);

  // The status entry carries a rename's old path, which leaves with it.
  const fileChanges = (paths: string[]): FileChange[] =>
    paths.map(
      (path) =>
        status.data?.files.find((f) => f.path === path) ?? {
          path,
          origPath: null,
          staged: "added",
          unstaged: null,
          isSubmodule: false,
        },
    );

  const fix = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setFindings(
        await unwrap(amendId ? commands.amendCheck(repo, amendId) : commands.commitCheck(repo)),
      );
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };
  const exclude = (row: CheckRow) => fix(() => unstage.mutateAsync(fileChanges(rowPaths(row))));
  const addToIgnore = (pattern: string, row: CheckRow) =>
    fix(() => ignore.mutateAsync({ patterns: [pattern], paths: rowPaths(row) }));

  const hasSecrets = rows.some((r) => r.kind === "secret");
  const submit = () => {
    if (!busy && canCommit) onCommit();
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t("check.title")}
      description={
        <span role="status">
          {rows.length > 0
            ? t("check.intro")
            : canCommit
              ? t("check.resolved")
              : t("check.nothingLeft")}
        </span>
      }
      onSubmit={submit}
      dismissible={!busy}
      footer={
        rows.length > 0 ? (
          <>
            <Button onClick={onClose} disabled={busy} autoFocus>
              {t("check.cancel")}
            </Button>
            <Button
              type="submit"
              variant={hasSecrets ? "danger" : "secondary"}
              disabled={busy || !canCommit}
            >
              {submitAnywayLabel ?? t("check.commitAnyway")}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t("check.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !canCommit} autoFocus>
              {submitLabel ?? t("check.commit")}
            </Button>
          </>
        )
      }
    >
      {GROUPS.map(({ kind, icon }) => {
        const group = rows.filter((r) => r.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} className={styles.group} aria-labelledby={`check-${kind}`}>
            <h3 id={`check-${kind}`} className={styles.groupTitle}>
              <Icon name={icon} className={kind === "secret" ? styles.danger : undefined} />
              {t(`check.groups.${kind}`)}
            </h3>
            {kind === "secret" && <p className={styles.hint}>{t("check.secret.hint")}</p>}
            {kind === "ignorable" && <p className={styles.hint}>{t("check.ignorable.hint")}</p>}
            <ul className={styles.rows}>
              {group.map((row) => (
                <li key={rowKey(row)} className={styles.row}>
                  <RowText row={row} />
                  <div className={styles.actions}>
                    {row.kind === "ignorable" && !amendId ? (
                      <Button disabled={busy} onClick={() => void addToIgnore(row.pattern, row)}>
                        {t("check.ignore")}
                      </Button>
                    ) : (
                      <>
                        {!amendId && row.kind === "secret" && row.ignorePattern && (
                          <Button
                            disabled={busy}
                            onClick={() => void addToIgnore(row.ignorePattern!, row)}
                          >
                            {t("check.ignore")}
                          </Button>
                        )}
                        <Button disabled={busy} onClick={() => void exclude(row)}>
                          {t("check.exclude")}
                        </Button>
                        {row.kind === "large_file" && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void openUrl(LFS_URL).catch((e) => setError(toAppError(e)))
                            }
                          >
                            {t("check.learnLfs")}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {error && <ErrorMessage error={error} />}
    </FormDialog>
  );
}

function RowText({ row }: { row: CheckRow }) {
  const { t } = useTranslation("changes");
  if (row.kind === "ignorable") {
    return (
      <div className={styles.text}>
        <span className={styles.name}>{row.pattern}</span>
        <span className={styles.detail}>
          {t("check.ignorable.files", { count: row.paths.length })}
        </span>
      </div>
    );
  }
  const { dir, name } = splitPath(row.path);
  return (
    <div className={styles.text}>
      <span className={styles.path}>
        {dir && <span className={styles.dir}>{dir}</span>}
        <span className={styles.name}>{name}</span>
      </span>
      {row.kind === "large_file" ? (
        <span className={styles.detail}>
          {t("check.large.size", { size: row.mib.toLocaleString() })} ·{" "}
          {row.mib >= GITHUB_LIMIT_MIB ? t("check.large.overLimit") : t("check.large.heavy")}
        </span>
      ) : (
        row.hits.map((hit, i) => (
          <span key={i} className={styles.detail}>
            {describeHit(t, hit)}
          </span>
        ))
      )}
    </div>
  );
}

function describeHit(t: ReturnType<typeof useTranslation<"changes">>["t"], hit: SecretHit): string {
  const line = String(hit.line ?? "");
  switch (hit.secret) {
    case "env_file":
      return t("check.secret.env_file");
    case "key_file":
      return t("check.secret.key_file");
    case "private_key":
      return t("check.secret.private_key", { line });
    default:
      return t("check.secret.token", {
        line,
        name: t(`check.secret.names.${hit.secret}`),
        preview: hit.preview ?? "",
      });
  }
}
