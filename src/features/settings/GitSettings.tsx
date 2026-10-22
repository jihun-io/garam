import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { ErrorMessage } from "../../components/ErrorMessage";
import { toAppError, type GlobalKey } from "../../ipc";
import { useGitGlobal, useSetGitGlobal } from "./api";
import { Setting } from "./controls";
import styles from "./SettingsDialog.module.css";

export function GitSettings() {
  const { t } = useTranslation("settings");
  const global = useGitGlobal();
  if (!global.data) return null;
  return (
    <>
      <p className={styles.hint}>{t("git.hint")}</p>
      <GitField settingKey="user_name" label={t("git.name")} saved={global.data.userName} />
      <GitField
        settingKey="user_email"
        label={t("git.email")}
        saved={global.data.userEmail}
        type="email"
      />
      <GitField
        settingKey="default_branch"
        label={t("git.defaultBranch")}
        saved={global.data.defaultBranch}
        placeholder={t("git.defaultBranchPlaceholder")}
      />
    </>
  );
}

/** Saves when focus leaves the field or Enter is pressed. */
function GitField({
  settingKey,
  label,
  saved,
  type = "text",
  placeholder,
}: {
  settingKey: GlobalKey;
  label: string;
  saved: string | null;
  type?: string;
  placeholder?: string;
}) {
  const { t } = useTranslation("settings");
  const set = useSetGitGlobal();
  const [value, setValue] = useState(saved ?? "");

  const save = () => {
    if (value.trim() === (saved ?? "")) return;
    set.mutate({ key: settingKey, value });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
  };

  return (
    <Setting
      label={label}
      hint={
        set.isError ? (
          <ErrorMessage error={toAppError(set.error)} />
        ) : set.isSuccess && value.trim() === (saved ?? "") ? (
          <span role="status">{t("git.saved")}</span>
        ) : undefined
      }
    >
      {(id) => (
        <input
          id={id}
          className={styles.input}
          type={type}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-invalid={set.isError || undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (set.isError || set.isSuccess) set.reset();
          }}
          onBlur={save}
          onKeyDown={onKeyDown}
        />
      )}
    </Setting>
  );
}
