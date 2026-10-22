import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import { Loading } from "../../components/ui/Loading";
import { Tooltip } from "../../components/ui/Tooltip";
import { toAppError, type ChangeKind, type CommitDetail, type CommitFile } from "../../ipc";
import { shortHash } from "../../lib/hash";
import { useRelativeTime } from "../../lib/time";
import diffStyles from "../changes/DiffView.module.css";
import { TextDiff } from "../changes/DiffView";
import { splitPath, type DisplayKind } from "../changes/fileState";
import { useCommitDetail, useCommitFileDiff } from "./api";
import styles from "./History.module.css";
import { RefBadges } from "./RefBadges";
import type { RefBadge, SyncState } from "./refs";

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
  badges,
  sync,
  onCopyHash,
}: {
  repo: string;
  oid: string;
  badges: RefBadge[];
  sync: SyncState | undefined;
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
  if (!detail.data) return <Loading />;
  return (
    <Loaded
      key={oid}
      repo={repo}
      commit={detail.data}
      badges={badges}
      sync={sync}
      onCopyHash={onCopyHash}
    />
  );
}

function Loaded({
  repo,
  commit,
  badges,
  sync,
  onCopyHash,
}: {
  repo: string;
  commit: CommitDetail;
  badges: RefBadge[];
  sync: SyncState | undefined;
  onCopyHash: (oid: string) => void;
}) {
  const { t, i18n } = useTranslation(["history", "changes"]);
  const relativeTime = useRelativeTime();
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
          <Tooltip content={commit.authorEmail}>
            <span>{commit.authorName}</span>
          </Tooltip>
          <Tooltip content={date.toLocaleString(i18n.language)}>
            <time dateTime={date.toISOString()}>{relativeTime(commit.authoredAt)}</time>
          </Tooltip>
          {commit.committerName !== commit.authorName && (
            <span>{t("detail.committedBy", { name: commit.committerName })}</span>
          )}
          {commit.parents.length > 1 && <span>{t("detail.merge")}</span>}
          {sync && (
            <span className={styles.syncNote}>
              <Icon name={sync === "unpushed" ? "push" : "pull"} size={12} />
              {t(sync === "unpushed" ? "sync.unpushed" : "detail.incoming")}
            </span>
          )}
          <RefBadges badges={badges} max={badges.length} />
          <Tooltip content={t("detail.copyHash", { hash })}>
            <button
              type="button"
              className={styles.hash}
              onClick={() => onCopyHash(commit.oid)}
              aria-label={t("detail.copyHash", { hash })}
            >
              {hash}
              <Icon name="copy" size={12} />
            </button>
          </Tooltip>
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
                    >
                      <Tooltip content={file.path} whenTruncated>
                        <span className={styles.fileName}>
                          <span className={styles.fileDir}>{dir}</span>
                          {name}
                        </span>
                      </Tooltip>
                      <Tooltip content={t(`changes:kind.${kind}`)} side="right">
                        <span className={`${styles.fileKind} ${styles[kind]}`}>
                          <Icon name={kind} label={t(`changes:kind.${kind}`)} />
                        </span>
                      </Tooltip>
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
    body = <Loading />;
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
        <Tooltip content={file.path} whenTruncated>
          <span className={diffStyles.headerPath}>{file.path}</span>
        </Tooltip>
        {file.origPath && (
          <span className={diffStyles.headerMeta}>
            {t("diff.renamedFrom", { path: file.origPath })}
          </span>
        )}
        <span className={`${diffStyles.badge} ${diffStyles[kind]}`}>
          <Icon name={kind} size={14} />
          {t(`kind.${kind}`)}
        </span>
      </header>
      {body}
    </section>
  );
}
