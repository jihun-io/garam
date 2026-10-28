import { ContextMenu, DropdownMenu } from "radix-ui";

import { menuEntries, type ContextMenuEntry } from "../../lib/nativeContextMenu";
import { Icon } from "../Icon";
import styles from "./Menu.module.css";

/** Browser preview of the same menu tree passed to the OS in the app. */
export function MenuItems({
  items,
  menu: Menu,
}: {
  items: ContextMenuEntry[];
  menu: typeof ContextMenu | typeof DropdownMenu;
}) {
  const entries = menuEntries(items);
  const checked = entries.findIndex(
    (item) => item !== "separator" && "checked" in item && item.checked,
  );
  const content = entries.map((item, index) => {
    if (item === "separator") return <Menu.Separator key={index} className={styles.separator} />;
    if ("kind" in item)
      return (
        <Menu.Group key={index} aria-label={item.label}>
          {item.label && <Menu.Label className={styles.label}>{item.label}</Menu.Label>}
          <MenuItems items={item.items} menu={Menu} />
        </Menu.Group>
      );
    if ("items" in item)
      return (
        <Menu.Sub key={index}>
          <Menu.SubTrigger className={styles.item} disabled={item.disabled}>
            {item.label}
            <Icon name="disclosure" size={12} className={styles.trailing} />
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent className={styles.content} sideOffset={4} alignOffset={-5}>
              <MenuItems items={item.items} menu={Menu} />
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
      );
    if (item.checked !== undefined)
      return (
        <Menu.RadioItem
          key={index}
          value={String(index)}
          className={styles.item}
          disabled={item.disabled}
          onSelect={() => void item.action()}
        >
          <span className={styles.indicator}>
            <Menu.ItemIndicator>
              <Icon name="check" size={12} />
            </Menu.ItemIndicator>
          </span>
          {item.label}
        </Menu.RadioItem>
      );
    return (
      <Menu.Item
        key={index}
        className={styles.item}
        disabled={item.disabled}
        onSelect={() => void item.action()}
      >
        {item.label}
      </Menu.Item>
    );
  });
  return entries.some((item) => item !== "separator" && "checked" in item) ? (
    <Menu.RadioGroup value={String(checked)}>{content}</Menu.RadioGroup>
  ) : (
    <>{content}</>
  );
}
