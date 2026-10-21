import { useEffect, useState } from "react";

import { defaultParentDir } from "../defaultParent";

/** The destination folder field, initialised to the default location. */
export function useParentDir() {
  const [parent, setParent] = useState("");
  useEffect(() => {
    let active = true;
    void defaultParentDir().then((dir) => {
      if (active) setParent((current) => current || dir);
    });
    return () => {
      active = false;
    };
  }, []);
  return [parent, setParent] as const;
}
