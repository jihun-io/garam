import { DropdownMenu } from "radix-ui";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../components/ui/IconButton";
import menu from "../../components/ui/Menu.module.css";
import { commands, unwrap } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { currentPlatform } from "../../lib/platform";
import { useNotify } from "../notify/notifyStore";
import { useSettings } from "../settings/api";
import { useRepoEditor } from "./api";
import { RepoEditorChoice } from "./EditorMenu";

/** "Open in" menu: file manager, terminal, and detected editors. */
export function OpenInMenu({ path, disabled }: { path: string; disabled?: boolean }) {
  const { t } = useTranslation("repos");
  const settings = useSettings();
  const { editor: firstEditor, editors } = useRepoEditor(path);
  const showError = useNotify((s) => s.showError);

  const run = (action: Promise<unknown>) => action.catch(showError);
  useCommand(
    "repo.openEditor",
    () => firstEditor && void run(unwrap(commands.externalOpenEditor(firstEditor.id, path))),
    !disabled && !!firstEditor,
  );
  useCommand(
    "repo.openTerminal",
    () => void run(unwrap(commands.externalOpenTerminal(path, settings.terminal))),
    !disabled,
  );
  useCommand("repo.reveal", () => void run(unwrap(commands.externalReveal(path))), !disabled);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <IconButton icon="openIn" label={t("open.menu")} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.content} align="end" sideOffset={4}>
          <DropdownMenu.Item
            className={menu.item}
            onSelect={() => void run(unwrap(commands.externalReveal(path)))}
          >
            {t(`open.reveal_${currentPlatform()}`)}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={menu.item}
            onSelect={() =>
              void run(unwrap(commands.externalOpenTerminal(path, settings.terminal)))
            }
          >
            {t("open.terminal")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={menu.separator} />
          {editors.length ? (
            editors.map((editor) => (
              <DropdownMenu.Item
                key={editor.id}
                className={menu.item}
                onSelect={() => void run(unwrap(commands.externalOpenEditor(editor.id, path)))}
              >
                {t("open.inApp", { name: editor.name })}
              </DropdownMenu.Item>
            ))
          ) : (
            <DropdownMenu.Item className={menu.item} disabled>
              {t("open.noEditors")}
            </DropdownMenu.Item>
          )}
          {editors.length > 1 && (
            <>
              <DropdownMenu.Separator className={menu.separator} />
              <RepoEditorChoice path={path} />
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
