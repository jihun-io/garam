import { useTranslation } from "react-i18next";

import { Splitter } from "../../components/ui/Splitter";
import { SIDEBAR, clampSidebarWidth, maxSidebarWidth, setSidebarWidth } from "../../lib/layout";
import { useSettings, useUpdateSettings } from "./api";

/** Resizes the changes/history sidebar and remembers the width. */
export function SidebarSplitter() {
  const { t } = useTranslation();
  const { sidebarWidth } = useSettings();
  const update = useUpdateSettings();
  return (
    <Splitter
      value={sidebarWidth}
      min={SIDEBAR.min}
      max={maxSidebarWidth}
      defaultValue={SIDEBAR.default}
      clamp={clampSidebarWidth}
      onPreview={setSidebarWidth}
      onCommit={(width) => update({ sidebarWidth: width })}
      label={t("layout.resizeSidebar")}
    />
  );
}
