import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import type { IconName } from "../../components/icons";
import { Tooltip } from "../../components/ui/Tooltip";
import type { RefKind, TagSync } from "../../ipc";
import styles from "./History.module.css";
import type { RefBadge, SyncState } from "./refs";

/** Badges past this many fold into a "+N" badge. */
const MAX_VISIBLE = 2;

const ICONS: Record<RefKind, IconName> = {
  head: "detachedHead",
  branch: "branch",
  remote: "remoteBranch",
  tag: "tag",
};

/**
 * Branch, remote branch and tag names at a commit. The visible names are
 * hidden from screen readers, which read the full description instead.
 */
export function RefBadges({
  badges,
  max = MAX_VISIBLE,
  tags,
}: {
  badges: RefBadge[];
  max?: number;
  /** How tags compare with the remote's; marks the ones it lacks or has elsewhere. */
  tags?: Map<string, TagSync> | null;
}) {
  const { t } = useTranslation("history");
  const describe = (badge: RefBadge) => describeBadge(t, badge, tags);
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const hidden = badges.slice(max);
  return (
    <span className={styles.refs}>
      {shown.map((badge) => (
        <Tooltip key={`${badge.kind}:${badge.name}`} content={describe(badge)}>
          <span className={styles.ref} data-current={badge.current || undefined}>
            <Icon name={ICONS[badge.kind]} size={12} filled={badge.current} />
            <span className={styles.refName} aria-hidden>
              {badge.name}
            </span>
            {badge.remotes.length > 0 && <Icon name="remoteBranch" size={12} />}
            {badge.kind === "tag" && tags?.get(badge.name) === "missing" && (
              <Icon name="notOnRemote" size={12} />
            )}
            {badge.kind === "tag" && tags?.get(badge.name) === "differs" && (
              <Icon name="differsOnRemote" size={12} />
            )}
            <span className="sr-only">{describe(badge)}</span>
          </span>
        </Tooltip>
      ))}{" "}
      {hidden.length > 0 && (
        <Tooltip
          content={hidden.map((badge) => (
            <div key={`${badge.kind}:${badge.name}`}>{describe(badge)}</div>
          ))}
        >
          <span className={styles.ref}>
            <span aria-hidden>{t("refs.more", { count: hidden.length })}</span>
            <span className="sr-only">{hidden.map(describe).join(", ")}</span>
          </span>
        </Tooltip>
      )}
    </span>
  );
}

function describeBadge(
  t: TFunction<"history">,
  badge: RefBadge,
  tags: Map<string, TagSync> | null | undefined,
): string {
  const { name } = badge;
  let text;
  switch (badge.kind) {
    case "head":
      text = t("refs.head");
      break;
    case "branch":
      text = badge.current ? t("refs.currentBranch", { name }) : t("refs.branch", { name });
      break;
    case "remote":
      text = t("refs.remote", { name });
      break;
    case "tag":
      text = t("refs.tag", { name });
      break;
  }
  if (badge.remotes.length > 0) {
    text += ` ${t("refs.alsoRemote", { names: badge.remotes.join(", ") })}`;
  }
  const sync = badge.kind === "tag" ? tags?.get(badge.name) : undefined;
  if (sync === "missing") text += ` ${t("refs.tagMissing")}`;
  if (sync === "differs") text += ` ${t("refs.tagDiffers")}`;
  return text;
}

/** An arrow for a commit that isn't pushed or pulled yet. */
export function SyncMark({ state }: { state: SyncState }) {
  const { t } = useTranslation("history");
  const text = t(state === "unpushed" ? "sync.unpushed" : "sync.incoming");
  return (
    <Tooltip content={text}>
      <span className={styles.sync}>
        <Icon name={state === "unpushed" ? "push" : "pull"} size={12} />
        <span className="sr-only">{text}</span>
      </span>
    </Tooltip>
  );
}
