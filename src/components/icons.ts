// One icon per meaning, so the same idea looks the same everywhere (see
// docs/UI.md 4.2). Screens use these names, never Phosphor directly.
// Icons are imported one by one so only the ones used are bundled.
import { ArrowCircleRight } from "@phosphor-icons/react/dist/csr/ArrowCircleRight";
import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CircleNotch } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { Cloud } from "@phosphor-icons/react/dist/csr/Cloud";
import { CloudArrowUp } from "@phosphor-icons/react/dist/csr/CloudArrowUp";
import { Code } from "@phosphor-icons/react/dist/csr/Code";
import { Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { FolderSimple } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { GearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { GitBranch } from "@phosphor-icons/react/dist/csr/GitBranch";
import { GitCommit } from "@phosphor-icons/react/dist/csr/GitCommit";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { MinusCircle } from "@phosphor-icons/react/dist/csr/MinusCircle";
import { Monitor } from "@phosphor-icons/react/dist/csr/Monitor";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { PlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { Prohibit } from "@phosphor-icons/react/dist/csr/Prohibit";
import { Record as RecordIcon } from "@phosphor-icons/react/dist/csr/Record";
import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { Tag } from "@phosphor-icons/react/dist/csr/Tag";
import { Terminal } from "@phosphor-icons/react/dist/csr/Terminal";
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
  editor: Code,
  terminal: Terminal,
  settings: GearSix,

  // Controls
  dropdown: CaretDown,
  more: DotsThree,
  close: X,
  check: Check,
  copy: Copy,
  loading: CircleNotch,

  // Notices and empty states
  info: Info,
  success: CheckCircle,
  error: WarningCircle,
  history: ClockCounterClockwise,

  // Refs in the history
  remoteBranch: Cloud,
  tag: Tag,
  detachedHead: GitCommit,

  // Appearance
  themeSystem: Monitor,
  themeLight: Sun,
  themeDark: Moon,

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
