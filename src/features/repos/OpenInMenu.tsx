import { DropdownMenu } from "radix-ui";
import { useTranslation } from "react-i18next";

import { IconButton } from "../../components/ui/IconButton";
import menu from "../../components/ui/Menu.module.css";
import { commands, unwrap } from "../../ipc";
import { currentPlatform } from "../../lib/platform";
import { useNotify } from "../notify/notifyStore";
import { useSettings } from "../settings/api";
import { useEditorsPreferredFirst } from "./api";

/** "Open in" menu: file manager, terminal, and detected editors. */
export function OpenInMenu({ path, disabled }: { path: string; disabled?: boolean }) {
  const { t } = useTranslation("repos");
  const settings = useSettings();
  const editors = useEditorsPreferredFirst(settings.editor);
  const showError = useNotify((s) => s.showError);

  const run = (action: Promise<unknown>) => action.catch(showError);

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
                {t("open.editor", { name: editor.name })}
              </DropdownMenu.Item>
            ))
          ) : (
            <DropdownMenu.Item className={menu.item} disabled>
              {t("open.noEditors")}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
