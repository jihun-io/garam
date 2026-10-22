import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/icons";
import { Checkbox } from "../../components/ui/Checkbox";
import { Loading } from "../../components/ui/Loading";
import { Tooltip } from "../../components/ui/Tooltip";
import {
  toAppError,
  type ChangeKind,
  type CommitDetail,
  type CommitFile,
  type SignatureStatus,
  type StashEntry,
} from "../../ipc";
import { shortHash } from "../../lib/hash";
import { useRelativeTime } from "../../lib/time";
import diffStyles from "../changes/DiffView.module.css";
import { ImageComparison, TextDiff } from "../changes/DiffView";
import { isImage, splitPath, type DisplayKind } from "../changes/fileState";
import { useNotify } from "../notify/notifyStore";
import {
  useCommitDetail,
  useCommitSignature,
  useFileDiff,
  useFileImages,
  useRemoteWebUrl,
  type DiffSource,
} from "./api";
import { CommitTitle } from "./CommitTitle";
import { useDiffOptions } from "./diffOptionsStore";
import styles from "./History.module.css";
import { isBreaking, linkIssues, splitCoAuthors } from "./message";
import { RefBadges } from "./RefBadges";
import type { RefBadge, SyncState } from "./refs";
import { stashTitle } from "./rows";

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
  stash,
  onCopyHash,
}: {
  repo: string;
  oid: string;
  badges: RefBadge[];
  sync: SyncState | undefined;
  /** Shown as stashed changes rather than a commit. */
  stash?: StashEntry;
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
      stash={stash}
      onCopyHash={onCopyHash}
    />
  );
}

function Loaded({
  repo,
  commit,
  badges,
  sync,
  stash,
  onCopyHash,
}: {
  repo: string;
  commit: CommitDetail;
  badges: RefBadge[];
  sync: SyncState | undefined;
  stash?: StashEntry;
  onCopyHash: (oid: string) => void;
}) {
  const { t, i18n } = useTranslation(["history", "changes"]);
  const relativeTime = useRelativeTime();
  const date = new Date(commit.authoredAt * 1000);
  const hash = shortHash(commit.oid);
  const webUrl = useRemoteWebUrl(repo);
  const showError = useNotify((s) => s.showError);
  const { body, coAuthors } = splitCoAuthors(commit.body);

  return (
    <div className={styles.detail}>
      <header className={styles.commitHeader}>
        <h2 className={styles.commitSummary}>
          {stash ? stashTitle(t, stash.message) : <CommitTitle summary={commit.summary} />}
        </h2>
        {!stash && isBreaking(commit.summary, commit.body) && (
          <p className={styles.breaking}>
            <Icon name="error" size={14} />
            {t("detail.breaking")}
          </p>
        )}
        {stash && <p className={styles.commitBody}>{t("stash.detail", { name: stash.name })}</p>}
        {!stash && body && (
          <p className={styles.commitBody}>
            <MessageText text={body} webUrl={webUrl} />
          </p>
        )}
        <p className={styles.commitMeta}>
          <Tooltip content={commit.authorEmail}>
            <span>{commit.authorName}</span>
          </Tooltip>
          {coAuthors.length > 0 && (
            <Tooltip content={coAuthors.map((p) => `${p.name} <${p.email}>`).join("\n")}>
              <span>
                {t("detail.coAuthors", { names: coAuthors.map((p) => p.name).join(", ") })}
              </span>
            </Tooltip>
          )}
          <Tooltip content={date.toLocaleString(i18n.language)}>
            <time dateTime={date.toISOString()}>{relativeTime(commit.authoredAt)}</time>
          </Tooltip>
          {commit.committerName !== commit.authorName && (
            <span>{t("detail.committedBy", { name: commit.committerName })}</span>
          )}
          {!stash && commit.parents.length > 1 && <span>{t("detail.merge")}</span>}
          {sync && (
            <span className={styles.syncNote}>
              <Icon name={sync === "unpushed" ? "push" : "pull"} size={12} />
              {t(sync === "unpushed" ? "sync.unpushed" : "detail.incoming")}
            </span>
          )}
          <RefBadges badges={badges} max={badges.length} />
          {!stash && <SignatureBadge repo={repo} oid={commit.oid} />}
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
          {!stash && webUrl && sync !== "unpushed" && (
            <button
              type="button"
              className={styles.metaLink}
              onClick={() => void openUrl(`${webUrl}/commit/${commit.oid}`).catch(showError)}
            >
              <Icon name="openIn" size={12} />
              {t("detail.openOnRemote")}
            </button>
          )}
        </p>
      </header>

      <ChangedFiles repo={repo} files={commit.files} source={{ kind: "commit", oid: commit.oid }} />
    </div>
  );
}

/** Files a commit or comparison changed, beside the selected file's diff. */
export function ChangedFiles({
  repo,
  files,
  source,
}: {
  repo: string;
  files: CommitFile[];
  source: DiffSource;
}) {
  const { t } = useTranslation(["history", "changes"]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selected = files.find((f) => f.path === selectedPath) ?? files[0] ?? null;
  if (files.length === 0) return <p className={diffStyles.notice}>{t("detail.noFiles")}</p>;
  return (
    <div className={styles.split}>
      <nav className={styles.files} aria-label={t("detail.files", { count: files.length })}>
        <p className={styles.filesTitle}>{t("detail.files", { count: files.length })}</p>
        <ul className={styles.fileList}>
          {files.map((file) => {
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
      {selected && <FileDiffPane repo={repo} source={source} file={selected} />}
    </div>
  );
}

function FileDiffPane({
  repo,
  source,
  file,
}: {
  repo: string;
  source: DiffSource;
  file: CommitFile;
}) {
  const { t } = useTranslation(["changes", "history"]);
  const { ignoreWhitespace, setIgnoreWhitespace } = useDiffOptions();
  const image = isImage(file.path);
  const diff = useFileDiff(repo, source, image ? null : file, ignoreWhitespace);
  const images = useFileImages(repo, source, file, image);
  const kind = displayKind(file.kind);

  let body;
  if (image) {
    body = images.data ? <ImageComparison path={file.path} {...images.data} /> : <Loading />;
  } else if (diff.isError) {
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
    body = <TextDiff key={`${file.path}:${ignoreWhitespace}`} hunks={diff.data.hunks} />;
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
        {!image && (
          <label className={styles.diffOption}>
            <Checkbox
              state={ignoreWhitespace ? "checked" : "unchecked"}
              onChange={(e) => setIgnoreWhitespace(e.target.checked)}
            />
            {t("history:detail.ignoreWhitespace")}
          </label>
        )}
      </header>
      {body}
    </section>
  );
}

/** Message text with `#123` turned into links when the remote is known. */
function MessageText({ text, webUrl }: { text: string; webUrl: string | null }) {
  const { t } = useTranslation("history");
  const showError = useNotify((s) => s.showError);
  if (!webUrl) return <>{text}</>;
  return (
    <>
      {linkIssues(text).map((part, i) =>
        "issue" in part ? (
          <Tooltip key={i} content={t("detail.openIssue", { ref: part.text })}>
            <a
              href={`${webUrl}/issues/${part.issue}`}
              className={styles.issueLink}
              onClick={(e) => {
                e.preventDefault();
                void openUrl(e.currentTarget.href).catch(showError);
              }}
            >
              {part.text}
            </a>
          </Tooltip>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

const SIGNATURE_ICON: Record<Exclude<SignatureStatus, "none">, IconName> = {
  good: "success",
  good_untrusted: "success",
  bad: "error",
  expired: "error",
  revoked: "error",
  cannot_check: "info",
};

/** Whether the commit is signed, checked once it is shown. */
function SignatureBadge({ repo, oid }: { repo: string; oid: string }) {
  const { t } = useTranslation("history");
  const signature = useCommitSignature(repo, oid, true).data;
  if (!signature || signature.status === "none") return null;
  const status = signature.status;
  const signer = signature.signer ?? t("signature.unknownSigner");
  return (
    <Tooltip content={t(`signature.${status}Hint`, { signer })}>
      <span
        className={styles.signature}
        data-bad={status === "bad" || status === "revoked" || undefined}
      >
        <Icon name={SIGNATURE_ICON[status]} size={12} />
        {t(`signature.${status}`)}
      </span>
    </Tooltip>
  );
}
