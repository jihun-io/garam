import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { commands, toAppError, unwrap, type SquashUndo } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { shortHash } from "../../lib/hash";
import { changesKeys, indexScope } from "../changes/api";
import { useNotify } from "../notify/notifyStore";
import { useSquashUndo, useSquashUndoDialog } from "./squashUndoStore";
import styles from "./History.module.css";

/** Registered for the whole repository, including while resolving conflicts. */
export function SquashUndoCommand({ repo }: { repo: string }) {
  const { t } = useTranslation("history");
  const undo = useSquashUndo(repo);
  const open = useSquashUndoDialog((s) => s.open);
  const last = useRef<string | null | undefined>(undefined);
  const showInfo = useNotify((s) => s.showInfo);
  useCommand(
    "history.undoSquash",
    () => {
      if (undo.data?.available) open(repo, undo.data);
    },
    undo.data?.available ?? false,
  );
  useEffect(() => {
    if (!undo.isSuccess) return;
    const info = undo.data;
    if (last.current !== undefined && info?.available && info.id !== last.current) {
      showInfo(t("done.squashed", { count: info.count }), {
        label: t("undoSquash.notice", { count: info.count }),
        run: () => open(repo, info),
      });
    }
    last.current = info?.id ?? null;
  }, [repo, undo.data, undo.isSuccess, open, showInfo, t]);
  return null;
}

/** Global so a notice always confirms and operates on its original repository. */
export function SquashUndoDialog() {
  const { request, close } = useSquashUndoDialog();
  return request ? (
    <UndoDialog key={`${request.repo}/${request.info.id}`} {...request} onClose={close} />
  ) : null;
}

function UndoDialog({
  repo,
  info,
  onClose,
}: {
  repo: string;
  info: SquashUndo;
  onClose: () => void;
}) {
  const { t } = useTranslation("history");
  const client = useQueryClient();
  const showInfo = useNotify((s) => s.showInfo);
  const undo = useMutation({
    mutationFn: () => unwrap(commands.squashUndo(repo, info.id)),
    scope: indexScope(repo),
    onSettled: () => client.invalidateQueries({ queryKey: changesKeys.all(repo) }),
    onSuccess: () => {
      showInfo(t("undoSquash.done"));
      onClose();
    },
  });
  return (
    <FormDialog
      open
      title={t("undoSquash.title", { count: info.count })}
      description={`${repo} · ${info.branch}`}
      onOpenChange={(open) => !open && !undo.isPending && onClose()}
      onSubmit={() => !undo.isPending && undo.mutate()}
      dismissible={!undo.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={undo.isPending} autoFocus>
            {t("undoSquash.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={undo.isPending}>
            {t("undoSquash.submit")}
          </Button>
        </>
      }
    >
      <p>{t("undoSquash.body", { count: info.count })}</p>
      <p>
        <code>{shortHash(info.after)}</code> → <code>{shortHash(info.before)}</code>
      </p>
      {info.contentChanged && <p>{t("undoSquash.contentChanged")}</p>}
      <p className={styles.dialogNote}>{t("undoSquash.safety")}</p>
      <p className={styles.dialogNote}>{t("undoSquash.recover")}</p>
      <p className={styles.dialogNote}>{t("undoSquash.remote")}</p>
      {undo.error && <ErrorMessage error={toAppError(undo.error)} />}
    </FormDialog>
  );
}
