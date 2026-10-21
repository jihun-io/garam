// Verifies that every locale has exactly the same keys as the source locale (en).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = new URL("../src/locales/", import.meta.url).pathname;
const SOURCE = "en";

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" ? flatten(value, path) : [path];
  });
}

function loadLocale(locale) {
  const dir = join(LOCALES_DIR, locale);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8"))]),
  );
}

function keysOf(namespaces) {
  return new Set(
    Object.entries(namespaces).flatMap(([ns, tree]) => flatten(tree).map((k) => `${ns}:${k}`)),
  );
}

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const sourceKeys = keysOf(loadLocale(SOURCE));
let problems = 0;

for (const locale of locales.filter((l) => l !== SOURCE)) {
  const keys = keysOf(loadLocale(locale));
  const missing = [...sourceKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !sourceKeys.has(k));
  for (const k of missing) console.error(`[${locale}] missing: ${k}`);
  for (const k of extra) console.error(`[${locale}] not in ${SOURCE}: ${k}`);
  problems += missing.length + extra.length;
}

if (problems > 0) {
  console.error(`\n${problems} i18n problem(s) found.`);
  process.exit(1);
}
console.log(`i18n OK: ${locales.length} locales, ${sourceKeys.size} keys each.`);
