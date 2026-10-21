import { open } from "@tauri-apps/plugin-dialog";

/** Shows the native folder picker. Resolves to null if dismissed. */
export async function chooseDirectory(defaultPath?: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, defaultPath });
  return typeof result === "string" ? result : null;
}
