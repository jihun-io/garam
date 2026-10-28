import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import { MenuButton } from "../../components/ui/MenuButton";
import type { ContextMenuEntry } from "../../lib/nativeContextMenu";
import { Tooltip } from "../../components/ui/Tooltip";
import { commands, unwrap, type ExternalEditor } from "../../ipc";
import { useNotify } from "../notify/notifyStore";
import { useRepoEditor, useRepositoryActions } from "./api";

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
  const editorChoice = useRepoEditorChoice(path);
  if (editors.length < 2) return null;

  const others = editors.filter((e) => e !== editor && !suggested.includes(e));
  const item = (e: ExternalEditor) => ({
    label: t("open.inApp", { name: e.name }),
    action: () => open(e.id),
  });
  return (
    <Tooltip content={t("open.otherEditor")}>
      <MenuButton
        align="end"
        items={[
          suggested.length > 0 && {
            kind: "group",
            label: t("open.suggested"),
            items: suggested.map(item),
          },
          suggested.length > 0 && others.length > 0 && "separator",
          others.length > 0 && {
            kind: "group",
            label: suggested.length > 0 ? t("open.otherApps") : undefined,
            items: others.map(item),
          },
          "separator",
          editorChoice,
        ]}
      >
        <SquareButton aria-label={t("open.otherEditor")} className={className} />
      </MenuButton>
    </Tooltip>
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
export function useRepoEditorChoice(path: string): ContextMenuEntry {
  const { t } = useTranslation("repos");
  const { installed, repoChoice, fromSettings } = useRepoEditor(path);
  const { setEditor } = useRepositoryActions();
  const showError = useNotify((s) => s.showError);
  if (installed.length === 0) return null;
  const choice = (editor: string | null, label: string) => ({
    label,
    checked: repoChoice === editor,
    action: () => setEditor.mutate({ path, editor }, { onError: showError }),
  });
  return {
    label: t("open.repoEditor"),
    items: [
      fromSettings && choice(null, t("open.followSettings", { name: fromSettings.name })),
      "separator",
      ...installed.map((editor) => choice(editor.id, editor.name)),
    ],
  };
}
