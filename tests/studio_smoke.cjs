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
    click() {
      for (const handler of listeners["click"] || []) {
        handler({ target: element, preventDefault() {} });
      }
    },
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
const windowListeners = {};
globalThis.addEventListener = (name, handler) => {
  (windowListeners[name] = windowListeners[name] || []).push(handler);
};
globalThis.dispatchWindow = (name, event = {}) => {
  for (const handler of windowListeners[name] || []) {
    handler({ target: {}, preventDefault() {}, ...event });
  }
};

const observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    observers.push(this);
  }
  observe(target) {
    this.observed.push(target);
  }
  fire() {
    const entries = this.observed.map((target) => ({ target }));
    this.callback(entries, this);
  }
};

globalThis.document = {
  body: { dataset: {} },
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
const orrerySource = fs.readFileSync(path.join(__dirname, "..", "src", "orrery.js"), "utf8");
(0, eval)(orrerySource);


// HUD collapse changes the canvas layout box without a window resize; the
// ResizeObserver wiring must re-fit the backing stores.
const mainCanvasBefore = elements["orrery-canvas"].width;
elements["orrery-canvas"].clientWidth = 400;
observers[observers.length - 1].fire();
if (elements["orrery-canvas"].width === mainCanvasBefore) {
  fail("hud collapse: the canvas backing store never re-fit after the observer fired");
}

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

// The query string carries the same deep-link knobs as the local studio's
// /api/config: rate, reverse, c and ke apply on every scenario load.
globalThis.location = { search: "?rate=4&reverse=1&c=15&ke=0.5&collision=merge&dt=0.004" };
elements["scenario-select"].value = "binary";
elements["scenario-select"].dispatch("change");
if (elements["warp-label"].textContent !== "4x") {
  fail(`url options: the rate override did not apply (${elements["warp-label"].textContent})`);
}
if (elements["btn-reverse"].textContent !== "REVERSE") {
  fail("url options: the reverse override did not apply");
}
if (!elements["check-relativity"].checked || elements["label-c"].textContent !== "c=15") {
  fail(`url options: the c override did not apply (${elements["label-c"].textContent})`);
}
if (!elements["check-coulomb"].checked || elements["label-ke"].textContent !== "ke=0.5") {
  fail(`url options: the ke override did not apply (${elements["label-ke"].textContent})`);
}
if (elements["label-dt"].textContent !== "0.004") {
  fail(`url options: the dt override did not apply (${elements["label-dt"].textContent})`);
}

// ?relativity=0 must clear the checkbox the scenario set.
globalThis.location = { search: "?relativity=0" };
elements["scenario-select"].dispatch("change");
if (elements["check-relativity"].checked) {
  fail("url options: ?relativity=0 did not clear the relativity checkbox");
}
globalThis.location = { search: "?rate=4&reverse=1&c=15&ke=0.5&collision=merge" };
elements["scenario-select"].dispatch("change");

// The URL must mirror the studio state (write-back), so a refresh or a
// copied link keeps the same view.
let lastUrl = null;
globalThis.history = {
  replaceState(state_, title_, url) {
    lastUrl = url;
  },
};
elements["btn-warp-up"].dispatch("click");
if (!lastUrl || lastUrl.indexOf("rate=6") === -1) {
  fail(`url write-back: the warp bump never reached the URL (${lastUrl})`);
}
if (lastUrl.indexOf("world=binary") === -1 || lastUrl.indexOf("collision=merge") === -1) {
  fail(`url write-back: the URL lost the world or collision state (${lastUrl})`);
}
elements["btn-reverse"].dispatch("click");
if (!lastUrl || lastUrl.indexOf("reverse=1") !== -1) {
  fail(`url write-back: toggling forward must drop reverse from the URL (${lastUrl})`);
}

// When embedded (e.g. the AegeanWorks play page), the frame reports its
// synced query to the parent window so the wrapper's address bar can mirror it.
const parentCaptured = [];
globalThis.parent = {
  postMessage(message, origin) {
    parentCaptured.push({ message, origin });
  },
};
elements["btn-warp-up"].dispatch("click");
if (!parentCaptured.length
    || String(parentCaptured[parentCaptured.length - 1].message.liveState || "").indexOf("rate=9") === -1) {
  fail(`url mirror: the frame never posted its state (${parentCaptured.length})`);
}

// A custom upload cannot come back from a reload, so the synced URL must
// not carry its key as world=... (a dead deep link).
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
if (lastUrl === null || lastUrl.indexOf("world=") !== -1) {
  fail(`url mirror: the custom world leaked a dead deep-link key (${lastUrl})`);
}
if (parentCaptured.length
    && parentCaptured[parentCaptured.length - 1].message.liveState !== lastUrl) {
  fail(`url mirror: the posted state diverges from the synced URL (${parentCaptured[parentCaptured.length - 1].message.liveState} vs ${lastUrl})`);
}
if (elements["select-collision"].value !== "merge") {
  fail(`url options: the collision override did not apply (${elements["select-collision"].value})`);
}

// Keyboard: Space toggles play/pause and R resets, matching the tooltips.
const faceBeforeSpace = elements["btn-play"].textContent;
globalThis.dispatchWindow("keydown", { code: "Space" });
if (elements["btn-play"].textContent === faceBeforeSpace) {
  fail(`keyboard: Space did not toggle the run (${elements["btn-play"].textContent})`);
}
globalThis.dispatchWindow("keydown", { code: "KeyR" });
pump(4);
const resetTime = Math.abs(parseFloat(elements["time-readout"].textContent.slice(4)));
if (!(resetTime < 0.3)) {
  fail(`keyboard: KeyR did not reset the world (t = ${resetTime})`);
}
if (elements["btn-play"].textContent !== "\u23F8") {
  fail("keyboard: KeyR unpaused the run");
}
globalThis.dispatchWindow("keydown", { code: "Space" });
if (elements["btn-play"].textContent !== "\u25B6") {
  fail("keyboard: Space did not pause the run again");
}
globalThis.location = { search: "" };

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

// The live-page watchdog handshake: body[data-screen] must appear on the
// first painted animation frame and prove the studio actually started.
if (!document.body || !document.body.dataset || document.body.dataset.screen !== "studio") {
  fail("boot: the live-page handshake (body data-screen) never fired");
}

// A fresh boot must honor ?world= (the query string picks the initial
// scenario; the served page instead takes it from /api/config).
globalThis.location = { search: "?world=figure-eight&dt=0.03" };
new Function(orrerySource)();
pump(2);
if (elements["scenario-select"].value !== "figure-eight") {
  fail(`url options: ?world did not select the initial scenario (${elements["scenario-select"].value})`);
}
if (elements["label-dt"].textContent !== "0.03") {
  fail(`url options: ?dt did not apply at boot (${elements["label-dt"].textContent})`);
}
