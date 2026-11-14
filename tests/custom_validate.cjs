/*
 * Validator parity harness for custom scenario uploads.
 *
 * Usage: node tests/custom_validate.cjs <expected-cases.json>
 *
 * The Python test (tests/test_custom_sealed_parity.py) generates JSON fixture
 * documents and computes, with the real orrery.custom loader on temp files,
 * whether each must be accepted and which first-line message a rejection
 * carries. This script replays the same documents through the sealed build's
 * in-process validator and compares. Exits non-zero on any mismatch.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const sourcePath = path.join(__dirname, "..", "src", "orrery.js");
(0, eval)(fs.readFileSync(sourcePath, "utf8"));

const document_ = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let mismatches = 0;

for (const item of document_.cases) {
  const result = globalThis.ORRERY_CORE.validateScenarioDocument(item.text);
  if (item.valid && result.valid && (!item.key || result.key === item.key)) {
    continue;
  }
  if (!item.valid && !result.valid && result.error.indexOf(item.error) === 0) {
    continue;
  }
  mismatches++;
  console.log(
    `MISMATCH ${item.name}: expected ` +
    `${item.valid ? "accepted" : `rejected (${item.error})`}, got ` +
    `${result.valid ? "accepted" : JSON.stringify(result.error)}`,
  );
}

if (mismatches) {
  process.exit(1);
}
console.log(`${document_.cases.length} validator case(s) in parity`);
