import { ContextMenu, Popover, RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import menu from "../../components/ui/Menu.module.css";
import segmented from "../../components/ui/Segmented.module.css";
import { Tooltip } from "../../components/ui/Tooltip";
import type { Tag, TagOrder } from "../../ipc";
import { useRelativeTime } from "../../lib/time";
import { useHistoryFilters } from "../history/filterStore";
import { useHistoryDialog } from "../history/historyDialogStore";
import { useNotify } from "../notify/notifyStore";
import { useTagPush, useTags, type TagStates } from "./api";
import styles from "./Tags.module.css";

const ORDERS: TagOrder[] = ["version", "newest"];

/**
 * A searchable list of tags beside the history search. Picking one shows
 * the history from that tag. Hidden when the repository has no tags.
 */
export function TagsButton({ repo, states }: { repo: string; states: TagStates }) {
  const { t } = useTranslation("history");
  const [order, setOrder] = useState<TagOrder>("version");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const tags = useTags(repo, order);
  const update = useHistoryFilters((s) => s.update);
  const openDialog = useHistoryDialog((s) => s.open);
  const push = useTagPush(repo);
  const { showError, showInfo } = useNotify();
  const relativeTime = useRelativeTime();

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (tags.data ?? []).filter(
      (tag) =>
        !q ||
        tag.name.toLocaleLowerCase().includes(q) ||
        tag.message?.toLocaleLowerCase().includes(q),
    );
  }, [tags.data, query]);
  if (!tags.data || tags.data.length === 0) return null;

  const { remote } = states;
  const sync = (tag: Tag) => states.states?.get(tag.name) ?? null;
  const missing = tags.data.filter((tag) => sync(tag) === "missing").map((tag) => tag.name);

  const showHistory = (tag: Tag) => {
    update(repo, { scope: { kind: "ref", refname: `refs/tags/${tag.name}` }, query: "" });
    setOpen(false);
  };
  const pushTags = (names: string[]) =>
    remote &&
    push.mutate(
      { remote, names, force: false },
      {
        onSuccess: () =>
          showInfo(
            names.length === 1
              ? t("done.tagPushed", { name: names[0], remote })
              : t("done.tagsPushed", { count: names.length, remote }),
          ),
        onError: showError,
      },
    );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton icon="tag" size={16} label={t("tags.label")} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.panel}
          align="end"
          sideOffset={4}
          aria-label={t("tags.label")}
        >
          <div className={styles.top}>
            <input
              type="search"
              className={styles.search}
              placeholder={t("tags.search")}
              aria-label={t("tags.search")}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <RadioGroup.Root
              className={segmented.track}
              aria-label={t("tags.order")}
              value={order}
              onValueChange={(value) => setOrder(value as TagOrder)}
            >
              {ORDERS.map((o) => (
                <RadioGroup.Item key={o} value={o} className={segmented.segment}>
                  {t(`tags.orders.${o}`)}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
          </div>
          {remote && missing.length > 0 && (
            <div className={styles.notice}>
              <Button icon="push" disabled={push.isPending} onClick={() => pushTags(missing)}>
                {t("tags.pushMissing", { count: missing.length, remote })}
              </Button>
            </div>
          )}
          {remote && states.failed && (
            <div className={styles.notice}>
              <p>{t("tags.unknown", { remote })}</p>
              <Button icon="fetch" disabled={states.rechecking} onClick={states.recheck}>
                {t("tags.recheck")}
              </Button>
            </div>
          )}
          <ul className={styles.list} aria-label={t("tags.list")}>
            {shown.map((tag) => {
              const state = sync(tag);
              return (
                <li key={tag.name}>
                  <ContextMenu.Root>
                    <ContextMenu.Trigger asChild>
                      <button type="button" className={styles.row} onClick={() => showHistory(tag)}>
                        <span className={styles.rowMain}>
                          <span className={styles.name}>
                            <Icon name="tag" size={12} />
                            {tag.name}
                            {state === "missing" && (
                              <Tooltip content={t("refs.tagMissing")}>
                                <span className={styles.state}>
                                  <Icon name="notOnRemote" size={12} label={t("refs.tagMissing")} />
                                </span>
                              </Tooltip>
                            )}
                            {state === "differs" && (
                              <Tooltip content={t("refs.tagDiffers")}>
                                <span className={styles.state}>
                                  <Icon
                                    name="differsOnRemote"
                                    size={12}
                                    label={t("refs.tagDiffers")}
                                  />
                                </span>
                              </Tooltip>
                            )}
                          </span>
                          <span className={styles.message}>{tag.message ?? tag.summary}</span>
                        </span>
                        <span className={styles.date}>{relativeTime(tag.createdAt)}</span>
                      </button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className={menu.content}>
                        <ContextMenu.Item className={menu.item} onSelect={() => showHistory(tag)}>
                          {t("tags.showHistory")}
                        </ContextMenu.Item>
                        {remote && state !== "same" && (
                          <ContextMenu.Item
                            className={menu.item}
                            onSelect={() =>
                              state === "differs"
                                ? openDialog({ kind: "overwriteTag", tag: tag.name, remote })
                                : pushTags([tag.name])
                            }
                          >
                            {state === "differs"
                              ? t("menu.overwriteTag", { name: tag.name })
                              : t("menu.pushTag", { name: tag.name })}
                          </ContextMenu.Item>
                        )}
                        <ContextMenu.Item
                          className={menu.item}
                          onSelect={() => void navigator.clipboard.writeText(tag.name)}
                        >
                          {t("tags.copyName")}
                        </ContextMenu.Item>
                        <ContextMenu.Separator className={menu.separator} />
                        <ContextMenu.Item
                          className={menu.item}
                          onSelect={() =>
                            openDialog({
                              kind: "deleteTag",
                              tag: tag.name,
                              commit: {
                                oid: tag.target,
                                parents: [],
                                authorName: "",
                                authorEmail: "",
                                authoredAt: 0,
                                summary: tag.summary,
                              },
                            })
                          }
                        >
                          {t("menu.deleteTag", { name: tag.name })}
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && <p className={styles.empty}>{t("tags.noMatch")}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
