import { useTranslation } from "react-i18next";

import { IconButton } from "../../components/ui/IconButton";
import { MenuButton } from "../../components/ui/MenuButton";
import { commands, unwrap } from "../../ipc";
import { useCommand } from "../../lib/commands";
import { currentPlatform } from "../../lib/platform";
import { useNotify } from "../notify/notifyStore";
import { useSettings } from "../settings/api";
import { useRepoEditor } from "./api";
import { useRepoEditorChoice } from "./EditorMenu";

/** "Open in" menu: file manager, terminal, and detected editors. */
export function OpenInMenu({ path, disabled }: { path: string; disabled?: boolean }) {
  const { t } = useTranslation("repos");
  const settings = useSettings();
  const { editor: firstEditor, editors } = useRepoEditor(path);
  const editorChoice = useRepoEditorChoice(path);
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
    <MenuButton
      disabled={disabled}
      align="end"
      items={[
        {
          label: t(`open.reveal_${currentPlatform()}`),
          action: () => run(unwrap(commands.externalReveal(path))),
        },
        {
          label: t("open.terminal"),
          action: () => run(unwrap(commands.externalOpenTerminal(path, settings.terminal))),
        },
        "separator",
        ...(editors.length
          ? editors.map((editor) => ({
              label: t("open.inApp", { name: editor.name }),
              action: () => run(unwrap(commands.externalOpenEditor(editor.id, path))),
            }))
          : [{ label: t("open.noEditors"), disabled: true, action: () => {} }]),
        editors.length > 1 && "separator",
        editors.length > 1 && editorChoice,
      ]}
    >
      <IconButton icon="openIn" label={t("open.menu")} />
    </MenuButton>
  );
}
