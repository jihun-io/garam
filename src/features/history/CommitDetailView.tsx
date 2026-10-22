import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { toAppError, type ChangeKind, type CommitDetail, type CommitFile } from "../../ipc";
import { shortHash } from "../../lib/hash";
import { relativeTime } from "../../lib/time";
import diffStyles from "../changes/DiffView.module.css";
import { TextDiff } from "../changes/DiffView";
import { splitPath, type DisplayKind } from "../changes/fileState";
import { useCommitDetail, useCommitFileDiff } from "./api";
import styles from "./History.module.css";

function displayKind(kind: ChangeKind): DisplayKind {
  switch (kind) {
    case "added":
    case "untracked":
      return "added";
    case "deleted":
      return "deleted";
    case "renamed":
    case "copied":
      return "renamed";
    case "conflicted":
      return "conflicted";
    default:
      return "modified";
  }
}

/** Message, author and changed files of one commit, with a file's diff. */
export function CommitDetailView({
  repo,
  oid,
  onCopyHash,
}: {
  repo: string;
  oid: string;
  onCopyHash: (oid: string) => void;
}) {
  const detail = useCommitDetail(repo, oid);
  if (detail.isError) {
    return (
      <div className={diffStyles.noticeBox}>
        <ErrorMessage error={toAppError(detail.error)} />
      </div>
    );
  }
  if (!detail.data) return null;
  return <Loaded key={oid} repo={repo} commit={detail.data} onCopyHash={onCopyHash} />;
}

function Loaded({
  repo,
  commit,
  onCopyHash,
}: {
  repo: string;
  commit: CommitDetail;
  onCopyHash: (oid: string) => void;
}) {
  const { t, i18n } = useTranslation(["history", "changes"]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selected = commit.files.find((f) => f.path === selectedPath) ?? commit.files[0] ?? null;
  const date = new Date(commit.authoredAt * 1000);
  const hash = shortHash(commit.oid);

  return (
    <div className={styles.detail}>
      <header className={styles.commitHeader}>
        <h2 className={styles.commitSummary}>{commit.summary}</h2>
        {commit.body && <p className={styles.commitBody}>{commit.body}</p>}
        <p className={styles.commitMeta}>
          <span title={commit.authorEmail}>{commit.authorName}</span>
          <time dateTime={date.toISOString()} title={date.toLocaleString(i18n.language)}>
            {relativeTime(commit.authoredAt, i18n.language)}
          </time>
          {commit.committerName !== commit.authorName && (
            <span>{t("detail.committedBy", { name: commit.committerName })}</span>
          )}
          {commit.parents.length > 1 && <span>{t("detail.merge")}</span>}
          <button
            type="button"
            className={styles.hash}
            onClick={() => onCopyHash(commit.oid)}
            aria-label={t("detail.copyHash", { hash })}
            title={commit.oid}
          >
            {hash}
          </button>
        </p>
      </header>

      {commit.files.length === 0 ? (
        <p className={diffStyles.notice}>{t("detail.noFiles")}</p>
      ) : (
        <div className={styles.split}>
          <nav
            className={styles.files}
            aria-label={t("detail.files", { count: commit.files.length })}
          >
            <p className={styles.filesTitle}>{t("detail.files", { count: commit.files.length })}</p>
            <ul className={styles.fileList}>
              {commit.files.map((file) => {
                const kind = displayKind(file.kind);
                const { dir, name } = splitPath(file.path);
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={styles.file}
                      aria-current={file.path === selected?.path ? "true" : undefined}
                      onClick={() => setSelectedPath(file.path)}
                      title={file.path}
                    >
                      <span className={styles.fileName}>
                        <span className={styles.fileDir}>{dir}</span>
                        {name}
                      </span>
                      <span className={`${styles.fileKind} ${styles[kind]}`}>
                        {t(`changes:kind.${kind}`)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          {selected && <CommitFileDiff repo={repo} oid={commit.oid} file={selected} />}
        </div>
      )}
    </div>
  );
}

function CommitFileDiff({ repo, oid, file }: { repo: string; oid: string; file: CommitFile }) {
  const { t } = useTranslation("changes");
  const diff = useCommitFileDiff(repo, oid, file);
  const kind = displayKind(file.kind);

  let body;
  if (diff.isError) {
    body = (
      <div className={diffStyles.noticeBox}>
        <ErrorMessage error={toAppError(diff.error)} />
      </div>
    );
  } else if (!diff.data) {
    body = null;
  } else if (diff.data.type === "binary") {
    body = <p className={diffStyles.notice}>{t("diff.binary")}</p>;
  } else if (diff.data.type === "too_large") {
    body = <p className={diffStyles.notice}>{t("diff.tooLarge")}</p>;
  } else if (diff.data.hunks.length === 0) {
    body = (
      <p className={diffStyles.notice}>
        {kind === "added" ? t("diff.emptyFile") : t("diff.noContent")}
      </p>
    );
  } else {
    body = <TextDiff key={file.path} hunks={diff.data.hunks} />;
  }

  return (
    <section className={diffStyles.root} aria-label={file.path}>
      <header className={diffStyles.header}>
        <span className={diffStyles.headerPath}>{file.path}</span>
        {file.origPath && (
          <span className={diffStyles.headerMeta}>
            {t("diff.renamedFrom", { path: file.origPath })}
          </span>
        )}
        <span className={`${diffStyles.badge} ${diffStyles[kind]}`}>{t(`kind.${kind}`)}</span>
      </header>
      {body}
    </section>
  );
}
