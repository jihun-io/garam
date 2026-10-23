import { useTranslation } from "react-i18next";

import { Splitter } from "../../components/ui/Splitter";
import {
  DETAIL_FILES,
  clampDetailFilesWidth,
  maxDetailFilesWidth,
  setDetailFilesWidth,
} from "../../lib/layout";
import { useSettings, useUpdateSettings } from "../settings/api";

/**
 * Resizes the file list beside the diff and remembers the width for every
 * commit, comparison and stash. `available` is the width of the whole
 * split, so the diff keeps its room.
 */
export function DetailFilesSplitter({ available }: { available: () => number }) {
  const { t } = useTranslation();
  const { detailFilesWidth } = useSettings();
  const update = useUpdateSettings();
  return (
    <Splitter
      value={detailFilesWidth}
      min={DETAIL_FILES.min}
      max={() => maxDetailFilesWidth(available())}
      defaultValue={DETAIL_FILES.default}
      clamp={(width) => clampDetailFilesWidth(width, available())}
      onPreview={setDetailFilesWidth}
      onCommit={(width) => update({ detailFilesWidth: width })}
      label={t("layout.resizeFiles")}
    />
  );
}
