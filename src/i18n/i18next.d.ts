import "i18next";

import type { resources } from "./index";

// Type-checks translation keys against the English (source) resources.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["en"];
    // Error keys mirror Rust's snake_case ErrorKind, so "_" must not mean "context".
    contextSeparator: "#";
  }
}
