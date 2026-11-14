/*
 * Parity harness for the sealed browser build.
 *
 * Usage: node tests/live_parity.cjs <expected-cases.json>
 *
 * The Python test (tests/test_live_parity.py) generates the expected cases
 * from orrery.sim itself, then this script replays the same cases through the
 * JavaScript core in src/orrery.js and compares the final states. It prints
 * one line per case and exits non-zero on any miss.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const sourcePath = path.join(__dirname, "..", "src", "orrery.js");
const source = fs.readFileSync(sourcePath, "utf8");
(0, eval)(source);
const core = globalThis.ORRERY_CORE;

function bodyOf(entry) {
  return core.makeBody(entry);
}

function runCase(item) {
  const world = new core.World(
    item.initial.map(bodyOf),
    item.g,
    { c: item.c === null ? null : item.c, k_e: item.k_e },
  );
  for (let index = 0; index < item.steps; index++) {
    world.step(item.dt);
    if (item.merge_radius > 0.0) {
      world.resolveCollisions(item.merge_radius);
    }
    if (item.bounce_radius > 0.0) {
      world.resolveElasticCollisions(item.bounce_radius, item.restitution);
    }
  }
  const scale = Math.max(
    1.0,
    ...item.expected.bodies.flatMap((body) => [Math.abs(body.x), Math.abs(body.y)]),
  );
  if (world.bodies.length !== item.expected.bodies.length) {
    return { name: item.name, error: Infinity, scale, detail:
      `body count ${world.bodies.length} != ${item.expected.bodies.length}` };
  }
  let worst = 0.0;
  let detail = "";
  for (let index = 0; index < world.bodies.length; index++) {
    const got = world.bodies[index];
    const want = item.expected.bodies[index];
    if (got.name !== want.name) {
      return { name: item.name, error: Infinity, scale, detail:
        `body ${index} is ${got.name}, expected ${want.name}` };
    }
    for (const field of ["x", "y", "vx", "vy"]) {
      const gap = Math.abs(got[field] - want[field]) / scale;
      if (gap > worst) {
        worst = gap;
        detail = `${got.name}.${field} ${got[field]} vs ${want[field]}`;
      }
    }
  }
  return { name: item.name, error: worst, scale, detail };
}

const document_path = process.argv[2];
const cases = JSON.parse(fs.readFileSync(document_path, "utf8"));
let failed = 0;
for (const item of cases.cases) {
  const result = runCase(item);
  const ok = result.error <= item.tol;
  if (!ok) {
    failed += 1;
    console.log(`FAIL ${result.name}: rel err ${result.error.toExponential(3)} ` +
      `(tol ${item.tol}) ${result.detail}`);
  } else {
    console.log(`ok   ${result.name}: rel err ${result.error.toExponential(3)} (tol ${item.tol})`);
  }
}
if (failed) {
  console.log(`${failed} case(s) failed`);
  process.exit(1);
}
console.log(`${cases.cases.length} parity case(s) within tolerance`);
