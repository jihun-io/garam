import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import menu from "../../components/ui/Menu.module.css";
import { commands, unwrap, type ConflictFile, type Side } from "../../ipc";
import { joinPath } from "../../lib/paths";
import { splitPath } from "../changes/fileState";
import { useNotify } from "../notify/notifyStore";
import { useRepoEditor } from "../repos/api";
import { useConflictActions } from "./api";
import styles from "./Conflicts.module.css";

/** Ways to resolve one conflicted file, shown above its diff. */
export function ConflictActions({ repo, file }: { repo: string; file: ConflictFile }) {
  const { t } = useTranslation("conflicts");
  const { resolve, markResolved } = useConflictActions(repo);
  const { editors } = useRepoEditor(repo);
  const showError = useNotify((s) => s.showError);
  const [confirmMarkers, setConfirmMarkers] = useState(false);
  const busy = resolve.isPending || markResolved.isPending;

  const choose = (side: Side) => resolve.mutate({ path: file.path, side }, { onError: showError });
  const mark = () => markResolved.mutate(file.path, { onError: showError });
  const open = (editorId: string) =>
    unwrap(commands.externalOpenEditor(editorId, joinPath(repo, file.path))).catch(showError);

  return (
    <div className={styles.actions} role="group" aria-label={t("file.label")}>
      <p className={styles.kind}>
        <Icon name="conflicted" className={styles.kindIcon} />
        {t(`kind.${file.kind}`)}
      </p>
      <div className={styles.buttons}>
        <Button onClick={() => choose("mine")} disabled={busy}>
          {t("file.useMine")}
        </Button>
        <Button onClick={() => choose("theirs")} disabled={busy}>
          {t("file.useTheirs")}
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button icon="editor" disabled={busy}>
              {t("file.openEditor")}
              <Icon name="dropdown" size={12} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={menu.content} sideOffset={4}>
              {editors.length ? (
                editors.map((editor) => (
                  <DropdownMenu.Item
                    key={editor.id}
                    className={menu.item}
                    onSelect={() => void open(editor.id)}
                  >
                    {t("file.editor", { name: editor.name })}
                  </DropdownMenu.Item>
                ))
              ) : (
                <DropdownMenu.Item className={menu.item} disabled>
                  {t("file.noEditors")}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Button
          variant="primary"
          icon="check"
          disabled={busy}
          onClick={() => (file.hasMarkers ? setConfirmMarkers(true) : mark())}
        >
          {t("file.markResolved")}
        </Button>
      </div>
      <p className={styles.hint}>{t("file.hint")}</p>
      {confirmMarkers && (
        <FormDialog
          open
          onOpenChange={(o) => !o && setConfirmMarkers(false)}
          title={t("markers.title")}
          onSubmit={() => {
            setConfirmMarkers(false);
            mark();
          }}
          footer={
            <>
              <Button onClick={() => setConfirmMarkers(false)} autoFocus>
                {t("markers.cancel")}
              </Button>
              <Button type="submit" variant="danger">
                {t("markers.confirm")}
              </Button>
            </>
          }
        >
          <p>{t("markers.body", { name: splitPath(file.path).name })}</p>
        </FormDialog>
      )}
    </div>
  );
}
