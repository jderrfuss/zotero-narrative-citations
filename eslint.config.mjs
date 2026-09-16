// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";
import globals from "globals";

export default [
  // spikes/ and scripts/ are pasted into Zotero's Tools > Developer >
  // Run JavaScript, which wraps them in an async function. They legitimately
  // use top-level `await` and a trailing bare `return` — a parse error for a
  // standalone module — so they are excluded from linting entirely.
  { ignores: ["spikes/**", "scripts/**", "scaffold/**"] },
  ...zotero(),
  // tools/ are Node build scripts, not plugin code running inside Zotero.
  {
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
];
