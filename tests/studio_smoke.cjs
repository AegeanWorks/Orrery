/*
 * Studio smoke test: boots the real studio code against a minimal DOM stub
 * and drives a handful of interactions. It catches wiring mistakes (a missing
 * element id, a thrown callback) that a parity test cannot see.
 *
 * Usage: node tests/studio_smoke.cjs
 * Exits non-zero with a message when anything breaks.
 */

"use strict";

const fs = require("fs");
const path = require("path");

function makeElement(tag) {
  const attributes = {};
  const children = [];
  const listeners = {};
  const element = {
    tag,
    attributes,
    children,
    textContent: "",
    value: "",
    disabled: false,
    checked: false,
    clientWidth: 800,
    clientHeight: 500,
    childElementCount: 0,
    get firstChild() {
      return children[0] || null;
    },
    get lastChild() {
      return children[children.length - 1] || null;
    },
    appendChild(child) {
      children.push(child);
      child.parent = element;
      element.childElementCount = children.length;
      return child;
    },
    prepend(child) {
      children.unshift(child);
      child.parent = element;
      element.childElementCount = children.length;
    },
    append(...items) {
      for (const item of items) {
        children.push(item);
        item.parent = element;
      }
      element.childElementCount = children.length;
    },
    remove() {
      if (element.parent) {
        const list = element.parent.children;
        list.splice(list.indexOf(element), 1);
        element.parent.childElementCount = list.length;
      }
    },
    addEventListener(name, handler) {
      (listeners[name] = listeners[name] || []).push(handler);
    },
    dispatch(name, event = {}) {
      for (const handler of listeners[name] || []) {
        handler({ target: element, preventDefault() {}, ...event });
      }
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    click() {},
    classList: {
      toggle() {},
    },
  };
  return element;
}

const ids = [
  "orrery-canvas", "energy-chart", "scenario-select", "btn-play",
  "btn-step-back", "btn-step-fwd", "btn-reverse", "btn-warp-down",
  "btn-warp-up", "warp-label", "btn-reset", "btn-toggle-hud", "hud-panel",
  "btn-upload", "file-input", "scenario-desc", "units-badge", "slider-dt",
  "label-dt", "check-relativity", "slider-c", "label-c", "check-coulomb",
  "slider-ke", "label-ke", "select-collision", "slider-trail", "label-trail",
  "select-dot-style", "select-tracking", "bodies-tbody", "time-readout",
  "val-drift", "val-virial", "val-ke", "val-pe",
];

const elements = {};
for (const id of ids) {
  elements[id] = makeElement("div");
  elements[id].id = id;
}
const canvas2d = {
  setTransform() {},
  fillRect() {},
  clearRect() {},
  beginPath() {},
  arc() {},
  fill() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  fillText() {},
  createLinearGradient() {
    return { addColorStop() {} };
  },
  createRadialGradient() {
    return { addColorStop() {} };
  },
};
elements["orrery-canvas"].getContext = () => canvas2d;
elements["energy-chart"].getContext = () => canvas2d;
elements["energy-chart"].clientWidth = 400;
elements["energy-chart"].clientHeight = 50;
elements["scenario-select"].value = "";
elements["slider-c"].min = "5";
elements["slider-c"].max = "100";
elements["slider-c"].value = "30";
elements["slider-ke"].min = "0";
elements["slider-ke"].max = "5";
elements["slider-ke"].value = "0.1";
elements["slider-dt"].min = "0.0001";
elements["slider-dt"].max = "1";
elements["slider-dt"].value = "0.01";
elements["slider-trail"].min = "50";
elements["slider-trail"].max = "4000";
elements["slider-trail"].value = "800";

let rafQueue = [];
globalThis.requestAnimationFrame = (callback) => {
  rafQueue.push(callback);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {
  rafQueue = [];
};
globalThis.devicePixelRatio = 1.0;
globalThis.location = { search: "" };
globalThis.addEventListener = () => {};

globalThis.document = {
  getElementById(id) {
    if (!elements[id]) {
      throw new Error(`the studio references a missing element id: ${id}`);
    }
    return elements[id];
  },
  createElement(tag) {
    return makeElement(tag);
  },
  createTextNode(text) {
    return { textContent: text };
  },
};

// Load the same generated data and the studio, which boots against the stub.
(0, eval)(fs.readFileSync(path.join(__dirname, "..", "data", "scenarios.js"), "utf8"));
(0, eval)(fs.readFileSync(path.join(__dirname, "..", "src", "orrery.js"), "utf8"));

function fail(message) {
  console.log(`FAIL ${message}`);
  process.exit(1);
}

function pump(frames) {
  for (let index = 0; index < frames; index++) {
    const queue = rafQueue;
    rafQueue = [];
    for (const callback of queue) {
      callback(performance.now());
    }
  }
}

function requireWorlds(count, label) {
  if (elements["scenario-select"].children.length !== count) {
    fail(`${label}: the world select holds ${elements["scenario-select"].children.length} entries, expected ${count}`);
  }
}

requireWorlds(9, "boot");
if (!elements["scenario-desc"].textContent) {
  fail("boot: the description stayed empty");
}
if (!elements["units-badge"].textContent) {
  fail("boot: the units badge stayed empty");
}
if (elements["units-badge"].textContent.length === 0) {
  fail("boot: the units badge stayed empty");
}

// Drive ten animation frames of the opening scenario; metrics refresh every
// four frames, so the HUD numbers and the bodies table must appear.
pump(10);
if (elements["time-readout"].textContent.indexOf("t = ") !== 0) {
  fail(`boot: the time readout never rendered (${elements["time-readout"].textContent})`);
}
if (elements["val-drift"].textContent.length === 0) {
  fail("boot: the drift metric never rendered");
}
if (elements["bodies-tbody"].children.length < 1) {
  fail("boot: the bodies table stayed empty");
}

elements["btn-play"].dispatch("click"); // Pause
if (elements["btn-play"].textContent !== "\u25B6") {
  fail(`pause: the play button shows ${elements["btn-play"].textContent}`);
}

// Manual steps in both directions, warp and reverse must all work.
elements["btn-step-fwd"].dispatch("click");
elements["btn-step-back"].dispatch("click");
elements["btn-reverse"].dispatch("click");
if (elements["btn-reverse"].textContent !== "REVERSE") {
  fail(`reverse: the badge shows ${elements["btn-reverse"].textContent}`);
}
elements["btn-warp-up"].dispatch("click");
if (elements["warp-label"].textContent === "1.0x") {
  fail("warp up: the label did not move");
}
elements["btn-warp-down"].dispatch("click");
elements["btn-reverse"].dispatch("click");

// Physics overrides rebuild the world without throwing.
elements["slider-dt"].value = "0.02";
elements["slider-dt"].dispatch("input");
elements["check-relativity"].checked = false;
elements["check-relativity"].dispatch("change");
elements["slider-c"].value = "60";
elements["slider-c"].dispatch("input");
elements["check-relativity"].checked = true;
elements["check-relativity"].dispatch("change");
elements["check-coulomb"].checked = true;
elements["check-coulomb"].dispatch("change");

// Camera and visual controls.
elements["select-tracking"].value = "1";
elements["select-tracking"].dispatch("change");
elements["select-dot-style"].value = "disc";
elements["select-dot-style"].dispatch("change");
elements["btn-toggle-hud"].dispatch("click");
elements["orrery-canvas"].dispatch("mousedown", { clientX: 10, clientY: 10 });
elements["orrery-canvas"].dispatch("mousemove", { clientX: 30, clientY: 20 });
elements["orrery-canvas"].dispatch("wheel", { deltaY: 120 });
pump(4);

// Reset, then a scenario switch must follow with its own description.
elements["btn-reset"].dispatch("click");
elements["scenario-select"].value = "pythagorean";
elements["scenario-select"].dispatch("change");
if (!elements["scenario-desc"].textContent.includes("3-4-5")) {
  fail("switch: the description did not follow the scenario");
}

// Inelastic merge on a colliding world must shrink the table without throwing.
elements["select-collision"].value = "merge";
elements["select-collision"].dispatch("change");
for (let index = 0; index < 5; index++) {
  elements["btn-warp-up"].dispatch("click");
}
pump(600);
const bodiesRows = elements["bodies-tbody"].children.length;
if (bodiesRows < 1 || bodiesRows > 3) {
  fail(`merge: the bodies table holds ${bodiesRows} rows`);
}
const markerRow = elements["bodies-tbody"].children[0];
const markerMarker = markerRow.children[0].children[0];
if (!markerMarker || !(markerMarker.attributes.style || "").startsWith("color: #")) {
  fail("legend: the bodies-table marker lost its per-body colour");
}

// Uploading a valid custom scenario registers it and swaps the world.
let uploads = [];
globalThis.alert = (message) => uploads.push(message);
globalThis.FileReader = class {
  readAsText() {
    this.onload({ target: { result: JSON.stringify({
      key: "duo",
      g: 1.0,
      dt: 0.005,
      span: 4.0,
      extent: [2.5, 2.5],
      bodies: [
        { name: "Heavy", mass: 1.0, position: [-0.5, 0.0], velocity: [0.05, 0.0], symbol: "H", color: "orange" },
        { name: "Light", mass: 1.0, position: [0.5, 0.0], velocity: [-0.05, 0.0], symbol: "L", color: "cyan" },
      ],
    }) } });
  }
};
elements["file-input"].dispatch("change", { target: { files: [{}] } });
if (elements["scenario-select"].children.length !== 10) {
  fail("upload: the custom world was not registered");
}
if (!uploads.some((message) => message.startsWith("Loaded custom scenario:"))) {
  fail(`upload: the success alert never fired (${uploads.join(" | ")})`);
}
elements["file-input"].dispatch("change", { target: { files: [{}] } });
if (elements["scenario-select"].children.length !== 10) {
  fail("upload: re-uploading the same scenario duplicated its option");
}

// A paused studio must stay paused across a reset and a world switch, exactly
// like the local studio (the run is still paused from the earlier pause step).
elements["btn-reset"].dispatch("click");
elements["scenario-select"].value = "solar";
elements["scenario-select"].dispatch("change");
pump(4);
if (elements["btn-play"].textContent !== "\u25B6") {
  fail("switch: the studio unpaused itself where the local studio stays paused");
}
elements["btn-play"].dispatch("click");

// Uploading invalid JSON must surface a validation error, never throw.
uploads = [];
globalThis.FileReader = class {
  readAsText() {
    this.onload({ target: { result: "{ not json" } });
  }
};
elements["file-input"].dispatch("change", { target: { files: [{}] } });
if (!uploads.some((message) => message.startsWith("Validation error:")
    || message.startsWith("Invalid JSON file"))) {
  fail(`upload: the invalid file did not produce a validation alert (${uploads.join(" | ")})`);
}

// A rejected scenario document (non-positive g) must carry the same message
// core the server loader uses.
const rejected = globalThis.ORRERY_CORE.validateScenarioDocument(
  JSON.stringify({ g: 0.0, dt: 0.01, span: 1.0, extent: [1, 1], bodies: [
    { name: "A", mass: 1.0, position: [0, 0], velocity: [0, 0], symbol: "A" },
  ] }),
);
if (rejected.valid || !rejected.error.includes("g must be greater than zero.")) {
  fail(`upload: the validator accepted a non-positive g (${JSON.stringify(rejected)})`);
}

if (globalThis.ORRERY_SCENARIOS.schema !== 1) {
  fail("the embedded scenario data lost its schema marker");
}

console.log("studio smoke: boot, animate, pause, step, reverse, warp, hud, camera, reset, switch, merge, upload and relativity all exercised");
