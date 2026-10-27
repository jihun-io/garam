import { useIsMutating } from "@tanstack/react-query";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Loading } from "../../components/ui/Loading";
import { commands, toAppError, type AmendSession, type FileChange, type Finding } from "../../ipc";
import {
  NO_SELECTION,
  move,
  reconcile,
  select,
  selectAll,
  type ListSelection,
} from "../../lib/listSelection";
import { shortHash } from "../../lib/hash";
import { useNotify } from "../notify/notifyStore";
import { SidebarSplitter } from "../settings/SidebarSplitter";
import { useSettings } from "../settings/api";
import { useAmendSessions } from "./amendStore";
import { useAmendActions } from "./amendApi";
import { useChangeActions, useStatus } from "./api";
import { CommitCheckDialog } from "./CommitCheckDialog";
import { DiffView } from "./DiffView";
import { FileList } from "./FileList";
import { checkState, combinedCheckState } from "./fileState";
import styles from "./ChangesView.module.css";
import form from "./CommitForm.module.css";
import amend from "./AmendView.module.css";

export function AmendView({
  repo,
  tabs,
  session,
}: {
  repo: string;
  tabs?: ReactNode;
  session: AmendSession;
}) {
  const { t } = useTranslation("changes");
  const ids = { summary: useId(), body: useId() };
  const status = useStatus(repo, session.id);
  const { stage, unstage } = useChangeActions(repo, session.id);
  const { save, cancel } = useAmendActions(repo, session.id);
  const showError = useNotify((s) => s.showError);
  const [rawSelection, setSelection] = useState<ListSelection>(NO_SELECTION);
  const draft = useAmendSessions((s) => s.drafts[repo]) ?? {
    summary: session.head.summary,
    body: session.head.body,
  };
  const { summary, body } = draft;
  const updateDraft = useAmendSessions((s) => s.updateDraft);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [checking, setChecking] = useState(false);
  const { commitChecks } = useSettings();
  const selecting = useIsMutating({ mutationKey: ["change-selection", repo] }) > 0;
  const busy = save.isPending || cancel.isPending || checking || selecting;
  const ready = summary.trim() !== "" && status.data !== undefined && !status.isError && !busy;
  const files = status.data?.files ?? [];
  const order = files.map((f) => f.path);
  const selection = reconcile(order, rawSelection);
  const selectedFiles = files.filter((f) => selection.keys.includes(f.path));
  const selected = selectedFiles.length === 1 ? selectedFiles[0] : null;
  const allState = combinedCheckState(files);
  const toggle = (targets: FileChange[], include: boolean) => {
    if (save.isPending || cancel.isPending) return;
    (include ? stage : unstage).mutate(targets, { onError: showError });
  };
  const toggleTogether = (targets: FileChange[]) =>
    toggle(targets, !targets.every((f) => checkState(f) === "checked"));
  const create = () => {
    save.mutate(body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim());
  };
  const submit = async () => {
    if (!ready) return;
    if (!commitChecks) {
      create();
      return;
    }
    setChecking(true);
    try {
      const result = await commands.amendCheck(repo, session.id);
      if (result.status === "ok" && result.data.length > 0) setFindings(result.data);
      else create();
    } catch {
      create();
    } finally {
      setChecking(false);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>
        {tabs}
        <div className={amend.banner} role="status">
          <strong>{t("amend.editing", { hash: shortHash(session.head.oid) })}</strong>
          <p>{t("amend.hint")}</p>
        </div>
        <div className={styles.listHeader}>
          <Checkbox
            state={allState}
            disabled={files.length === 0 || busy}
            aria-label={t("list.selectAll")}
            onChange={() => toggle(files, allState !== "checked")}
          />
          <span className={styles.listTitle}>{t("list.title", { count: files.length })}</span>
        </div>
        {status.error ? (
          <div className={amend.error}>
            <ErrorMessage error={toAppError(status.error)} />
          </div>
        ) : !status.data ? (
          <Loading />
        ) : files.length > 0 ? (
          <div className={amend.files} inert={save.isPending || cancel.isPending || checking}>
            <FileList
              repo={repo}
              files={files}
              selection={selection}
              onSelect={(path, how) => setSelection(select(order, selection, path, how))}
              onSelectAll={() => setSelection(selectAll(order, selection))}
              onMove={(delta, extend) => setSelection(move(order, selection, delta, extend))}
              onToggle={toggleTogether}
            />
          </div>
        ) : (
          <div className={styles.listEmpty} />
        )}
        <SidebarSplitter />
        <form
          className={form.form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className={form.srOnly} htmlFor={ids.summary}>
            {t("commit.summary")}
          </label>
          <input
            autoFocus
            id={ids.summary}
            className={form.summary}
            value={summary}
            onChange={(e) => updateDraft(repo, { ...draft, summary: e.target.value })}
            onKeyDown={keyDown}
            disabled={busy}
          />
          <label className={form.srOnly} htmlFor={ids.body}>
            {t("commit.description")}
          </label>
          <textarea
            id={ids.body}
            className={form.description}
            rows={4}
            value={body}
            onChange={(e) => updateDraft(repo, { ...draft, body: e.target.value })}
            onKeyDown={keyDown}
            disabled={busy}
          />
          {save.error && <ErrorMessage error={toAppError(save.error)} />}
          {save.error && ["head_moved", "index_changed"].includes(toAppError(save.error).kind) && (
            <p className={form.hint}>{t("amend.restart")}</p>
          )}
          {cancel.error && <ErrorMessage error={toAppError(cancel.error)} />}
          <div className={amend.actions}>
            <Button disabled={busy} onClick={() => cancel.mutate()}>
              {t("amend.cancel")}
            </Button>
            <Button type="submit" variant="primary" icon="commit" disabled={!ready}>
              {t("amend.save")}
            </Button>
          </div>
        </form>
      </aside>
      <div className={styles.main} inert={save.isPending || cancel.isPending || checking}>
        {selectedFiles.length > 1 ? (
          <div className={amend.multiple}>
            <p>{t("selection.title", { count: selectedFiles.length })}</p>
            <Button onClick={() => toggleTogether(selectedFiles)}>
              {selectedFiles.every((f) => checkState(f) === "checked")
                ? t("selection.exclude")
                : t("selection.include")}
            </Button>
          </div>
        ) : (
          <DiffView repo={repo} file={selected} amendId={session.id} />
        )}
      </div>
      {findings && (
        <CommitCheckDialog
          repo={repo}
          amendId={session.id}
          findings={findings}
          canCommit={summary.trim() !== ""}
          submitLabel={t("amend.save")}
          submitAnywayLabel={t("amend.saveAnyway")}
          onCommit={() => {
            setFindings(null);
            create();
          }}
          onClose={() => setFindings(null)}
        />
      )}
    </div>
  );
}
