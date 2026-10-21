import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";

import { toAppError } from "../../ipc";
import { useRepositoryActions } from "./api";
import { useRepoDialog } from "./dialogStore";

/**
 * Adds folders dropped onto the window as repositories. If a folder can't be
 * added (e.g. it isn't a repository), opens the add dialog to explain why.
 * Returns whether something is being dragged over the window.
 */
export function useFolderDrop() {
  const [dragging, setDragging] = useState(false);
  const { add } = useRepositoryActions();
  const openDialog = useRepoDialog((s) => s.open);
  // Stable across renders (TanStack Query memoizes it).
  const addRepository = add.mutateAsync;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const handleDrop = async (paths: string[]) => {
      for (const path of paths) {
        try {
          await addRepository(path);
        } catch (e) {
          openDialog({ kind: "add", path, error: toAppError(e) });
          return;
        }
      }
    };

    try {
      void getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "enter" || payload.type === "over") setDragging(true);
          else if (payload.type === "leave") setDragging(false);
          else {
            setDragging(false);
            void handleDrop(payload.paths);
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        });
    } catch {
      // Not running inside Tauri (tests, plain browser preview).
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addRepository, openDialog]);

  return dragging;
}
