# Test fixtures

Copied unmodified for the offline tests. Not covered by this project's
AGPL-3.0 licence.

- `styles/*.csl` — the 15 CSL styles bundled with Zotero, as installed and
  updated by Zotero 10.0.2 on 2026-09-16. These are the versions the plugin was
  tested against in Word. From the
  [Citation Style Language styles repository](https://github.com/citation-style-language/styles);
  authors and contributors are credited in each file's `<info>` block.
- `locales-en-US.xml` — the CSL en-US locale shipped with Zotero 10.0.2
  (`chrome/content/zotero/locale/csl/`). From the
  [CSL locales repository](https://github.com/citation-style-language/locales).

All are licensed under
[Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

To refresh them after a Zotero update, copy the `.csl` files from the `styles`
folder of your Zotero data directory, then review any change in expected
output before updating the tests.
