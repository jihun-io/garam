import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { toAppError, type DiffLine, type FileChange, type Hunk } from "../../ipc";
import { useDiff, useImages } from "./api";
import { displayKind, isImage } from "./fileState";
import styles from "./DiffView.module.css";

type Row = { type: "hunk"; hunk: Hunk } | { type: "line"; line: DiffLine };

export function DiffView({ repo, file }: { repo: string; file: FileChange | null }) {
  const { t } = useTranslation("changes");
  const diff = useDiff(repo, file);

  if (!file) {
    return <p className={styles.notice}>{t("diff.selectFile")}</p>;
  }

  const kind = displayKind(file);
  const header = (
    <header className={styles.header}>
      <span className={styles.headerPath}>{file.path}</span>
      {file.origPath && (
        <span className={styles.headerMeta}>{t("diff.renamedFrom", { path: file.origPath })}</span>
      )}
      <span className={`${styles.badge} ${styles[kind]}`}>{t(`kind.${kind}`)}</span>
    </header>
  );

  let body;
  if (diff.isError) {
    body = (
      <div className={styles.noticeBox}>
        <ErrorMessage error={toAppError(diff.error)} />
      </div>
    );
  } else if (!diff.data) {
    body = null;
  } else if (diff.data.type === "binary") {
    body = isImage(file.path) ? (
      <ImageDiff repo={repo} file={file} />
    ) : (
      <p className={styles.notice}>{t("diff.binary")}</p>
    );
  } else if (diff.data.type === "too_large") {
    body = <p className={styles.notice}>{t("diff.tooLarge")}</p>;
  } else if (diff.data.hunks.length === 0) {
    body = (
      <p className={styles.notice}>
        {kind === "added" ? t("diff.emptyFile") : t("diff.noContent")}
      </p>
    );
  } else {
    body = <TextDiff key={file.path} hunks={diff.data.hunks} />;
  }

  return (
    <section className={styles.root} aria-label={file.path}>
      {header}
      {body}
    </section>
  );
}

function TextDiff({ hunks }: { hunks: Hunk[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo<Row[]>(
    () =>
      hunks.flatMap((hunk) => [
        { type: "hunk", hunk } as Row,
        ...hunk.lines.map((line) => ({ type: "line", line }) as Row),
      ]),
    [hunks],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  return (
    <div ref={scrollRef} className={styles.scroll}>
      <div className={styles.lines} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={styles.rowWrap}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.type === "hunk" ? <HunkHeader hunk={row.hunk} /> : <Line line={row.line} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HunkHeader({ hunk }: { hunk: Hunk }) {
  return (
    <div className={styles.hunk}>
      <span className={styles.hunkRange}>
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </span>
      {hunk.section && <span className={styles.hunkSection}>{hunk.section}</span>}
    </div>
  );
}

const MARKER = { context: " ", added: "+", deleted: "-" } as const;

function Line({ line }: { line: DiffLine }) {
  return (
    <div className={`${styles.line} ${styles[line.kind]}`}>
      <span className={styles.gutter}>{line.oldLine ?? ""}</span>
      <span className={styles.gutter}>{line.newLine ?? ""}</span>
      <span className={styles.marker} aria-hidden="true">
        {MARKER[line.kind]}
      </span>
      <span className={styles.text}>
        {line.text}
        {line.noNewline && (
          <span className={styles.noNewline} aria-hidden="true">
            {" "}
            ⊘
          </span>
        )}
      </span>
    </div>
  );
}

function ImageDiff({ repo, file }: { repo: string; file: FileChange }) {
  const { t } = useTranslation("changes");
  const images = useImages(repo, file, true);
  if (!images.data) return null;
  const side = (label: string, src: string | null) => (
    <figure className={styles.imageSide}>
      <figcaption className={styles.imageLabel}>{label}</figcaption>
      <div className={styles.imageFrame}>
        {src ? (
          <img src={src} alt={`${label}: ${file.path}`} className={styles.image} />
        ) : (
          <span className={styles.imageNone}>{t("diff.noImage")}</span>
        )}
      </div>
    </figure>
  );
  return (
    <div className={styles.images}>
      {side(t("diff.before"), images.data.before)}
      {side(t("diff.after"), images.data.after)}
    </div>
  );
}
