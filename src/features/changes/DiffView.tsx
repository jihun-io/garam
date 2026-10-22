import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Loading } from "../../components/ui/Loading";
import {
  toAppError,
  type ConflictFile,
  type DiffLine,
  type FileChange,
  type Hunk,
  type LineRef,
} from "../../ipc";
import { ConflictActions } from "../conflicts/ConflictActions";
import { useChangeActions, useDiff, useImages } from "./api";
import { displayKind, isImage } from "./fileState";
import styles from "./DiffView.module.css";
import { useNotify } from "../notify/notifyStore";
import { Icon } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";

type Row = { type: "hunk"; hunk: Hunk } | { type: "line"; line: DiffLine };

/** `conflict` adds the ways to resolve a conflicted file above its diff. */
export function DiffView({
  repo,
  file,
  conflict,
}: {
  repo: string;
  file: FileChange | null;
  conflict?: ConflictFile;
}) {
  const { t } = useTranslation("changes");
  const diff = useDiff(repo, file);
  const { stageLines } = useChangeActions(repo);
  const showError = useNotify((st) => st.showError);

  if (!file) {
    return <p className={styles.notice}>{t("diff.selectFile")}</p>;
  }

  const kind = displayKind(file);
  const header = (
    <header className={styles.header}>
      <Tooltip content={file.path} whenTruncated>
        <span className={styles.headerPath}>{file.path}</span>
      </Tooltip>
      {file.origPath && (
        <span className={styles.headerMeta}>{t("diff.renamedFrom", { path: file.origPath })}</span>
      )}
      <span className={`${styles.badge} ${styles[kind]}`}>
        <Icon name={kind} size={14} />
        {t(`kind.${kind}`)}
      </span>
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
    body = <Loading />;
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
    const target = file;
    body = (
      <TextDiff
        key={file.path}
        hunks={diff.data.hunks}
        onStageLines={
          diff.data.selectable
            ? (selected) => stageLines.mutate({ file: target, selected }, { onError: showError })
            : undefined
        }
      />
    );
  }

  return (
    <section className={styles.root} aria-label={file.path}>
      {header}
      {conflict && <ConflictActions repo={repo} file={conflict} />}
      {body}
    </section>
  );
}

type LineKey = string;

function lineRef(line: DiffLine): LineRef | null {
  if (line.kind === "added" && line.newLine !== null) return { kind: "added", line: line.newLine };
  if (line.kind === "deleted" && line.oldLine !== null)
    return { kind: "deleted", line: line.oldLine };
  return null;
}

const keyOf = (ref: LineRef): LineKey => `${ref.kind}:${ref.line}`;

function refOfKey(key: LineKey): LineRef {
  const [kind, line] = key.split(":");
  return { kind: kind as LineRef["kind"], line: Number(line) };
}

/**
 * Text diff. When `onStageLines` is given, changed lines get a selection
 * margin: click or drag to choose which lines are in the commit.
 */
export function TextDiff({
  hunks,
  onStageLines,
}: {
  hunks: Hunk[];
  onStageLines?: (selected: LineRef[]) => void;
}) {
  const { t } = useTranslation("changes");
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo<Row[]>(
    () =>
      hunks.flatMap((hunk) => [
        { type: "hunk", hunk } as Row,
        ...hunk.lines.map((line) => ({ type: "line", line }) as Row),
      ]),
    [hunks],
  );
  const staged = useMemo(() => {
    const keys = new Set<LineKey>();
    for (const line of hunks.flatMap((h) => h.lines)) {
      const ref = lineRef(line);
      if (ref && line.staged) keys.add(keyOf(ref));
    }
    return keys;
  }, [hunks]);

  // The selection just sent to git, shown until fresh diff data arrives
  // (tied to `hunks` so a refetch replaces it).
  const [pending, setPending] = useState<{ for: Hunk[]; keys: Set<LineKey> } | null>(null);
  const [drag, setDrag] = useState<{ include: boolean; keys: Set<LineKey> } | null>(null);
  const current = pending?.for === hunks ? pending.keys : staged;

  const withDrag = (keys: Set<LineKey>) => {
    if (!drag) return keys;
    const next = new Set(keys);
    for (const key of drag.keys) {
      if (drag.include) next.add(key);
      else next.delete(key);
    }
    return next;
  };
  const shown = withDrag(current);

  const commit = (next: Set<LineKey>) => {
    setPending({ for: hunks, keys: next });
    onStageLines?.([...next].map(refOfKey));
  };

  const toggle = (keys: LineKey[], include: boolean) => {
    const next = new Set(current);
    for (const key of keys) {
      if (include) next.add(key);
      else next.delete(key);
    }
    commit(next);
  };

  // Finish a drag wherever the mouse is released.
  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      commit(withDrag(current));
      setDrag(null);
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  const selectable = onStageLines !== undefined;

  // One tab stop for the whole diff: arrow keys move between the block and
  // line controls, so a long diff doesn't take hundreds of Tab presses.
  const controls = useMemo(() => {
    if (!selectable) return [];
    const list: { key: string; row: number }[] = [];
    rows.forEach((row, index) => {
      if (row.type === "hunk") {
        if (row.hunk.lines.some((l) => lineRef(l))) list.push({ key: `hunk:${index}`, row: index });
      } else {
        const ref = lineRef(row.line);
        if (ref) list.push({ key: keyOf(ref), row: index });
      }
    });
    return list;
  }, [rows, selectable]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = controls.some((c) => c.key === activeKey) ? activeKey : (controls[0]?.key ?? null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest === 0 || !active) return;
    // The row may only now be rendered after scrolling to it.
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-control="${active}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, active]);

  const onControlKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const index = controls.findIndex((c) => c.key === active);
    const target = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: controls.length - 1,
    }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    const next = controls[Math.max(0, Math.min(controls.length - 1, target))];
    if (!next) return;
    setActiveKey(next.key);
    virtualizer.scrollToIndex(next.row, { align: "auto" });
    setFocusRequest((n) => n + 1);
  };
  const control = (key: string) => ({
    "data-control": key,
    tabIndex: key === active ? 0 : -1,
    onKeyDown: onControlKeyDown,
    onFocus: () => setActiveKey(key),
  });

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      // A read-only diff has nothing to focus inside; make it scrollable
      // from the keyboard.
      tabIndex={selectable ? undefined : 0}
      role={selectable ? undefined : "region"}
      aria-label={selectable ? undefined : t("diff.label")}
    >
      <div
        className={`${styles.lines} ${selectable ? styles.selectable : ""}`}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          let content;
          if (row.type === "hunk") {
            const keys = row.hunk.lines
              .map(lineRef)
              .filter((r) => r !== null)
              .map(keyOf);
            const allIn = keys.length > 0 && keys.every((k) => shown.has(k));
            content = (
              <HunkHeader
                hunk={row.hunk}
                toggle={
                  selectable && keys.length > 0
                    ? {
                        allIn,
                        onToggle: () => toggle(keys, !allIn),
                        control: control(`hunk:${item.index}`),
                      }
                    : undefined
                }
              />
            );
          } else {
            const ref = lineRef(row.line);
            const key = ref && keyOf(ref);
            content = (
              <Line
                line={row.line}
                selection={
                  selectable && key
                    ? {
                        included: shown.has(key),
                        onPress: () =>
                          setDrag({ include: !current.has(key), keys: new Set([key]) }),
                        onEnter: () =>
                          drag && setDrag({ ...drag, keys: new Set(drag.keys).add(key) }),
                        onKeyboardToggle: () => toggle([key], !current.has(key)),
                        control: control(key),
                      }
                    : selectable
                      ? "spacer"
                      : undefined
                }
              />
            );
          }
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={styles.rowWrap}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HunkHeader({
  hunk,
  toggle,
}: {
  hunk: Hunk;
  toggle?: { allIn: boolean; onToggle: () => void; control: ControlProps };
}) {
  const { t } = useTranslation("changes");
  return (
    <div className={styles.hunk}>
      <span className={styles.hunkRange}>
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </span>
      {hunk.section && <span className={styles.hunkSection}>{hunk.section}</span>}
      {toggle && (
        <button
          type="button"
          className={styles.hunkToggle}
          onClick={toggle.onToggle}
          {...toggle.control}
        >
          {toggle.allIn ? t("diff.unstageHunk") : t("diff.stageHunk")}
        </button>
      )}
    </div>
  );
}

const MARKER = { context: " ", added: "+", deleted: "-" } as const;

type ControlProps = {
  "data-control": string;
  tabIndex: number;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
};

type Selection = {
  control: ControlProps;
  included: boolean;
  onPress: () => void;
  onEnter: () => void;
  onKeyboardToggle: () => void;
};

function Line({ line, selection }: { line: DiffLine; selection?: Selection | "spacer" }) {
  const { t } = useTranslation("changes");
  const included = typeof selection === "object" && selection.included;
  const excluded = typeof selection === "object" && !selection.included;
  return (
    <div
      className={`${styles.line} ${styles[line.kind]} ${excluded ? styles.excluded : ""}`}
      onMouseEnter={typeof selection === "object" ? selection.onEnter : undefined}
    >
      {selection === "spacer" && <span className={styles.select} />}
      {typeof selection === "object" && (
        <button
          type="button"
          role="checkbox"
          aria-checked={included}
          aria-label={t(line.kind === "added" ? "diff.addedLine" : "diff.deletedLine", {
            line: line.newLine ?? line.oldLine,
            text: line.text.trim().slice(0, 80),
          })}
          className={styles.select}
          {...selection.control}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            // Don't start a text selection while dragging over lines.
            e.preventDefault();
            selection.onPress();
          }}
          // Mouse clicks are handled on mousedown; this is for the keyboard.
          onClick={(e) => e.detail === 0 && selection.onKeyboardToggle()}
        >
          <span className={styles.selectBox} />
        </button>
      )}
      <span className={styles.gutter}>{line.oldLine ?? ""}</span>
      <span className={styles.gutter}>{line.newLine ?? ""}</span>
      <span className={styles.marker} aria-hidden="true">
        {MARKER[line.kind]}
      </span>
      <span className={styles.text}>
        {line.text}
        {line.noNewline && (
          <span className={styles.noNewline}>
            <Icon name="noNewline" size={12} />
          </span>
        )}
      </span>
    </div>
  );
}

function ImageDiff({ repo, file }: { repo: string; file: FileChange }) {
  const { t } = useTranslation("changes");
  const images = useImages(repo, file, true);
  if (!images.data) return <Loading />;
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
