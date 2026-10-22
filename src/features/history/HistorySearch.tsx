import { Popover, RadioGroup } from "radix-ui";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import segmented from "../../components/ui/Segmented.module.css";
import { Select, type SelectOption } from "../../components/ui/Select";
import type { HistoryScope, SearchField } from "../../ipc";
import { shortcutFor, useCommand } from "../../lib/commands";
import { useBranches } from "../branches/api";
import { hasFilters, isUnfiltered, useHistoryFilter, useHistoryFilters } from "./filterStore";
import styles from "./History.module.css";

const FIELDS: SearchField[] = ["message", "author", "content"];

/** Search box over the commit list, with the rest of the filter in a popover. */
export function HistorySearch({ repo }: { repo: string }) {
  const { t } = useTranslation("history");
  const filter = useHistoryFilter(repo);
  const update = useHistoryFilters((s) => s.update);
  const reset = useHistoryFilters((s) => s.reset);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = hasFilters(filter);

  useCommand("history.search", () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  });

  return (
    <div className={styles.searchBar} role="search">
      <div className={styles.searchField}>
        <Icon name="search" size={14} />
        <input
          ref={inputRef}
          type="search"
          className={styles.searchInput}
          placeholder={t(`search.placeholder.${filter.searchIn}`)}
          aria-label={t("search.label")}
          aria-keyshortcuts={shortcutFor("history.search") ?? undefined}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={filter.query}
          onChange={(e) => update(repo, { query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.nativeEvent.isComposing && filter.query) {
              e.preventDefault();
              update(repo, { query: "" });
            }
          }}
        />
      </div>
      <Popover.Root>
        <Popover.Trigger asChild>
          <IconButton
            icon="filter"
            size={16}
            filled={filtered}
            label={t(filtered ? "filter.active" : "filter.label")}
            className={filtered ? styles.filterOn : undefined}
          />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={styles.filterPanel}
            align="end"
            sideOffset={4}
            aria-label={t("filter.label")}
          >
            <FilterOptions repo={repo} />
            <div className={styles.filterFooter}>
              <Button variant="ghost" disabled={isUnfiltered(filter)} onClick={() => reset(repo)}>
                {t("filter.reset")}
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function FilterOptions({ repo }: { repo: string }) {
  const { t } = useTranslation("history");
  const filter = useHistoryFilter(repo);
  const update = useHistoryFilters((s) => s.update);
  const branches = useBranches(repo);
  const id = useId();

  const scopeOptions: SelectOption<string>[] = [
    { value: "head", label: t("filter.scopes.head") },
    { value: "all", label: t("filter.scopes.all") },
    ...(branches.data ?? []).map((b) => ({
      value: `refs/${b.kind === "local" ? "heads" : "remotes"}/${b.name}`,
      label: b.name,
    })),
  ];
  const scopeValue = filter.scope.kind === "ref" ? filter.scope.refname : filter.scope.kind;
  const toScope = (value: string): HistoryScope =>
    value === "head" || value === "all" ? { kind: value } : { kind: "ref", refname: value };

  return (
    <div className={styles.filterOptions}>
      <div className={styles.filterRow}>
        <span className={styles.filterLabel} id={`${id}-in`}>
          {t("filter.searchIn")}
        </span>
        <RadioGroup.Root
          className={segmented.track}
          aria-labelledby={`${id}-in`}
          value={filter.searchIn}
          onValueChange={(searchIn) => update(repo, { searchIn: searchIn as SearchField })}
        >
          {FIELDS.map((field) => (
            <RadioGroup.Item key={field} value={field} className={segmented.segment}>
              {t(`filter.fields.${field}`)}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterLabel} htmlFor={`${id}-scope`}>
          {t("filter.scope")}
        </label>
        <Select
          id={`${id}-scope`}
          value={scopeValue}
          options={scopeOptions}
          onChange={(value) => update(repo, { scope: toScope(value) })}
        />
      </div>
      <Field
        label={t("filter.path")}
        hint={t("filter.pathHint")}
        value={filter.path}
        onChange={(e) => update(repo, { path: e.target.value })}
      />
      <label className={styles.filterCheck}>
        <Checkbox
          state={filter.firstParent ? "checked" : "unchecked"}
          onChange={(e) => update(repo, { firstParent: e.target.checked })}
        />
        {t("filter.firstParent")}
      </label>
    </div>
  );
}
