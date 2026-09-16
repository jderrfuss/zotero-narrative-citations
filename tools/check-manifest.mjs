/**
 * Post-build manifest check.
 *
 * Zotero reports every manifest defect as the same dialog:
 *
 *   "could not be installed. It may be incompatible with this version of
 *    Zotero."
 *
 * which names neither the field nor the reason, and misleadingly implicates the
 * version pins. This asserts the rules that actually apply, so a bad manifest
 * fails the build with the field name instead of failing the install with a
 * shrug.
 *
 * Rules mirrored from the shipped Zotero 10.0.2 build
 * (/Applications/Zotero.app/Contents/Resources/omni.ja):
 *   Extension.sys.mjs:1875-1883   applications.zotero.{id,update_url,strict_max_version} required
 *   XPIInstall.sys.mjs:495        "*" illegal in strict_min_version
 *   Schemas.sys.mjs:1176          every "format":"url" field goes through new URL()
 */

import fs from "node:fs";
import path from "node:path";

const BUILD = "scaffold/build/addon";
const manifestPath = path.join(BUILD, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.error(
    `check-manifest: ${manifestPath} not found; run the build first`,
  );
  process.exit(1);
}

const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const problems = [];

const zotero = m.applications?.zotero;
if (!zotero?.id) problems.push("applications.zotero.id is required");
if (!zotero?.update_url)
  problems.push("applications.zotero.update_url is required");
if (!zotero?.strict_max_version)
  problems.push("applications.zotero.strict_max_version is required");

if (zotero?.strict_min_version?.split(".").some((p) => p === "*"))
  problems.push('strict_min_version may not contain "*"');

// Any URL-typed field is run through `new URL()`. An empty string throws, and
// an absent optional field is fine -- so check presence, not truthiness.
const urlFields = [
  ["homepage_url", m.homepage_url],
  ["developer.url", m.developer?.url],
  ["applications.zotero.update_url", zotero?.update_url],
];
for (const [name, value] of urlFields) {
  if (value === undefined) continue;
  try {
    new URL(value);
  } catch (e) {
    problems.push(
      `${name} = ${JSON.stringify(value)} -> new URL() throws: ${e.message}`,
    );
  }
}

for (const [size, rel] of Object.entries(m.icons || {})) {
  if (!fs.existsSync(path.join(BUILD, rel)))
    problems.push(`icons["${size}"] points at a missing file: ${rel}`);
}

if (problems.length) {
  console.error(
    "\ncheck-manifest: the built manifest would be rejected by Zotero:\n",
  );
  for (const p of problems) console.error("  - " + p);
  console.error("");
  process.exit(1);
}

console.log("check-manifest: ok");
