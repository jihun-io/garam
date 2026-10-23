import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { FormDialog } from "../../components/ui/Dialog";
import { Loading } from "../../components/ui/Loading";
import menu from "../../components/ui/Menu.module.css";
import { Tooltip } from "../../components/ui/Tooltip";
import { toAppError, type Stash } from "../../ipc";
import { useRelativeTime } from "../../lib/time";
import { BranchNameDialog } from "../branches/BranchNameDialog";
import diffStyles from "../changes/DiffView.module.css";
import { ChangedFiles } from "../history/CommitDetailView";
import historyStyles from "../history/History.module.css";
import { useNotify } from "../notify/notifyStore";
import { stashTitle, useStashActions, useStashFiles } from "./api";
import styles from "./Stashes.module.css";
import { useRestoreStash } from "./useRestoreStash";

/** What a stash holds, with the ways to bring it back or discard it. */
export function StashDetail({ repo, stash }: { repo: string; stash: Stash }) {
  const { t, i18n } = useTranslation("stashes");
  const relativeTime = useRelativeTime();
  const files = useStashFiles(repo, stash.oid);
  const { restore, busy: restoring } = useRestoreStash(repo);
  const actions = useStashActions(repo);
  const { showError, showInfo } = useNotify();
  const [dialog, setDialog] = useState<"drop" | "branch" | null>(null);
  const title = stashTitle(t, stash);
  const date = new Date(stash.createdAt * 1000);
  const busy = restoring || actions.drop.isPending || actions.branch.isPending;

  const drop = () =>
    actions.drop.mutate(stash.oid, {
      onSuccess: () => {
        setDialog(null);
        showInfo(t("done.dropped"), {
          label: t("done.undo"),
          run: () =>
            actions.restore.mutate(stash.oid, {
              onSuccess: () => showInfo(t("done.restored")),
              onError: showError,
            }),
        });
      },
      onError: showError,
    });

  let body;
  if (files.isError) {
    body = (
      <div className={diffStyles.noticeBox}>
        <ErrorMessage error={toAppError(files.error)} />
      </div>
    );
  } else if (!files.data) {
    body = <Loading />;
  } else {
    body = (
      <ChangedFiles
        key={stash.oid}
        repo={repo}
        files={files.data}
        source={{ kind: "stash", oid: stash.oid }}
      />
    );
  }

  return (
    <div className={historyStyles.detail}>
      <header className={historyStyles.commitHeader}>
        <h2 className={historyStyles.commitSummary}>{title}</h2>
        {stash.auto && <p className={historyStyles.commitBody}>{t("detail.auto")}</p>}
        <p className={historyStyles.commitMeta}>
          {stash.branch && <span>{t("detail.on", { branch: stash.branch })}</span>}
          <Tooltip content={date.toLocaleString(i18n.language)}>
            <time dateTime={date.toISOString()}>
              {t("detail.when", { time: relativeTime(stash.createdAt) })}
            </time>
          </Tooltip>
        </p>
        <div className={styles.actions}>
          <Tooltip content={t("actions.popHint")}>
            <Button variant="primary" disabled={busy} onClick={() => restore(stash.oid, true)}>
              {t("actions.pop")}
            </Button>
          </Tooltip>
          <Tooltip content={t("actions.applyHint")}>
            <Button disabled={busy} onClick={() => restore(stash.oid, false)}>
              {t("actions.apply")}
            </Button>
          </Tooltip>
          <DropdownMenu.Root>
            <Tooltip content={t("actions.more")}>
              <DropdownMenu.Trigger asChild disabled={busy}>
                <Button aria-label={t("actions.more")}>
                  <Icon name="more" size={16} />
                </Button>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.content} align="start" sideOffset={4}>
                <DropdownMenu.Item className={menu.item} onSelect={() => setDialog("branch")}>
                  {t("actions.branch")}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className={menu.separator} />
                <DropdownMenu.Item className={menu.item} onSelect={() => setDialog("drop")}>
                  {t("actions.drop")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {body}

      {dialog === "drop" && (
        <FormDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={t("drop.title")}
          onSubmit={drop}
          footer={
            <>
              <Button onClick={() => setDialog(null)} autoFocus>
                {t("drop.cancel")}
              </Button>
              <Button type="submit" variant="danger" disabled={actions.drop.isPending}>
                {t("drop.confirm")}
              </Button>
            </>
          }
        >
          <p>{t("drop.body", { title })}</p>
        </FormDialog>
      )}
      {dialog === "branch" && (
        <BranchNameDialog
          title={t("branch.title")}
          label={t("branch.name")}
          submitLabel={t("branch.submit")}
          note={t("branch.body")}
          onSubmit={(name) =>
            actions.branch
              .mutateAsync({ oid: stash.oid, name })
              .then(() => showInfo(t("done.branched", { branch: name })))
          }
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
