import { useTranslation } from "react-i18next";

import { Button } from "../../../components/ui/Button";
import { chooseDirectory } from "../chooseDirectory";

export function BrowseButton({
  current,
  onChoose,
  disabled,
}: {
  current?: string;
  onChoose: (dir: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("repos");
  return (
    <Button
      disabled={disabled}
      onClick={async () => {
        const dir = await chooseDirectory(current || undefined);
        if (dir) onChoose(dir);
      }}
    >
      {t("form.browse")}
    </Button>
  );
}
