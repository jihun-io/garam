import { documentDir } from "@tauri-apps/api/path";

// TODO(M8): move to the persisted settings store.
const KEY = "garam.lastParentDir";

/** Folder new and cloned repositories go into by default. */
export async function defaultParentDir(): Promise<string> {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    // Fall through to the documents folder.
  }
  return documentDir();
}

export function rememberParentDir(dir: string) {
  try {
    localStorage.setItem(KEY, dir);
  } catch {
    // Not remembered; harmless.
  }
}
