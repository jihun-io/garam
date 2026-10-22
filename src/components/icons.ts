// One icon per meaning, so the same idea looks the same everywhere (see
// docs/UI.md 4.2). Screens use these names, never Phosphor directly.
// Icons are imported one by one so only the ones used are bundled.
import { ArrowCircleRight } from "@phosphor-icons/react/dist/csr/ArrowCircleRight";
import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CloudArrowUp } from "@phosphor-icons/react/dist/csr/CloudArrowUp";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { FolderSimple } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { GearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { GitBranch } from "@phosphor-icons/react/dist/csr/GitBranch";
import { MinusCircle } from "@phosphor-icons/react/dist/csr/MinusCircle";
import { PlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { Prohibit } from "@phosphor-icons/react/dist/csr/Prohibit";
import { Record as RecordIcon } from "@phosphor-icons/react/dist/csr/Record";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { X } from "@phosphor-icons/react/dist/csr/X";

export const Icons = {
  // Toolbar
  repository: FolderSimple,
  branch: GitBranch,
  fetch: ArrowsClockwise,
  pull: ArrowDown,
  push: ArrowUp,
  publish: CloudArrowUp,
  openIn: ArrowSquareOut,
  settings: GearSix,

  // Controls
  dropdown: CaretDown,
  more: DotsThree,
  close: X,

  // File changes
  added: PlusCircle,
  modified: RecordIcon,
  deleted: MinusCircle,
  renamed: ArrowCircleRight,
  conflicted: WarningCircle,

  // Diff
  noNewline: Prohibit,
} as const;

export type IconName = keyof typeof Icons;
