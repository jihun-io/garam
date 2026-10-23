import { DropdownMenu } from "radix-ui";
import { forwardRef, useId, type ButtonHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import menu from "../../components/ui/Menu.module.css";
import { Tooltip } from "../../components/ui/Tooltip";
import { commands, unwrap, type ExternalEditor } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useRepoEditor, useRepositoryActions } from "./api";

// Radix radio groups can't use "" or null as a value; no editor id looks like this.
const FOLLOW_SETTINGS = "follow-settings";

/** Opens `path` in an editor, reporting a failure. */
export function useOpenEditor(path: string) {
  const showError = useNotify((s) => s.showError);
  return (editorId: string) =>
    void unwrap(commands.externalOpenEditor(editorId, path)).catch(showError);
}

/**
 * The square half of the "Open in editor" button: opens the repository in
 * an editor other than the usual one, or changes the usual one for this
 * repository. Hidden while there is no other editor to pick.
 */
export function MoreEditorsButton({ path, className }: { path: string; className?: string }) {
  const { t } = useTranslation("repos");
  const { editor, editors, suggested } = useRepoEditor(path);
  const open = useOpenEditor(path);
  const suggestedId = useId();
  const othersId = useId();
  if (editors.length < 2) return null;

  const others = editors.filter((e) => e !== editor && !suggested.includes(e));
  const item = (e: ExternalEditor) => (
    <DropdownMenu.Item key={e.id} className={menu.item} onSelect={() => open(e.id)}>
      {t("open.inApp", { name: e.name })}
    </DropdownMenu.Item>
  );

  return (
    <DropdownMenu.Root>
      <Tooltip content={t("open.otherEditor")}>
        <DropdownMenu.Trigger asChild>
          <SquareButton aria-label={t("open.otherEditor")} className={className} />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.content} align="end" sideOffset={4}>
          {suggested.length > 0 && (
            <DropdownMenu.Group aria-labelledby={suggestedId}>
              <DropdownMenu.Label id={suggestedId} className={menu.label}>
                {t("open.suggested")}
              </DropdownMenu.Label>
              {suggested.map(item)}
            </DropdownMenu.Group>
          )}
          {suggested.length > 0 && others.length > 0 && (
            <DropdownMenu.Separator className={menu.separator} />
          )}
          {others.length > 0 && (
            <DropdownMenu.Group aria-labelledby={suggested.length > 0 ? othersId : undefined}>
              {suggested.length > 0 && (
                <DropdownMenu.Label id={othersId} className={menu.label}>
                  {t("open.otherApps")}
                </DropdownMenu.Label>
              )}
              {others.map(item)}
            </DropdownMenu.Group>
          )}
          <DropdownMenu.Separator className={menu.separator} />
          <RepoEditorChoice path={path} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const SquareButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SquareButton(props, ref) {
    return (
      <button ref={ref} type="button" {...props}>
        <Icon name="dropdown" size={12} />
      </button>
    );
  },
);

/**
 * Submenu choosing the editor this repository opens in, or following the
 * app settings. Lives where the editor is used, so a repository that needs
 * Xcode doesn't send anyone to the settings window.
 */
export function RepoEditorChoice({ path }: { path: string }) {
  const { t } = useTranslation("repos");
  const { installed, repoChoice, fromSettings } = useRepoEditor(path);
  const { setEditor } = useRepositoryActions();
  const showError = useNotify((s) => s.showError);
  if (installed.length === 0) return null;

  const choose = (value: string) =>
    setEditor.mutate(
      { path, editor: value === FOLLOW_SETTINGS ? null : value },
      { onError: showError },
    );
  const radio = (value: string, label: string) => (
    <DropdownMenu.RadioItem key={value} value={value} className={menu.item}>
      <span className={menu.indicator}>
        <DropdownMenu.ItemIndicator>
          <Icon name="check" size={12} />
        </DropdownMenu.ItemIndicator>
      </span>
      {label}
    </DropdownMenu.RadioItem>
  );

  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={menu.item}>
        {t("open.repoEditor")}
        <Icon name="disclosure" size={12} className={menu.trailing} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className={menu.content} sideOffset={4} alignOffset={-5}>
          <DropdownMenu.RadioGroup value={repoChoice ?? FOLLOW_SETTINGS} onValueChange={choose}>
            {fromSettings &&
              radio(FOLLOW_SETTINGS, t("open.followSettings", { name: fromSettings.name }))}
            <DropdownMenu.Separator className={menu.separator} />
            {installed.map((e) => radio(e.id, e.name))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
