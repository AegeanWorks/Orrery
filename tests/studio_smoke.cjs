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
    childElementCount: 0,
    lastChild: null,
    appendChild(child) {
      children.push(child);
      child.parent = element;
      element.childElementCount = children.length;
      element.lastChild = child;
      return child;
    },
    prepend(child) {
      children.unshift(child);
      child.parent = element;
      element.childElementCount = children.length;
      element.lastChild = children[children.length - 1] || null;
    },
    append(...items) {
      for (const item of items) {
        children.push(item);
        item.parent = element;
      }
      element.childElementCount = children.length;
      element.lastChild = children[children.length - 1] || null;
    },
    remove() {
      if (element.parent) {
        const list = element.parent.children;
        list.splice(list.indexOf(element), 1);
        element.parent.childElementCount = list.length;
        element.parent.lastChild = list[list.length - 1] || null;
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
  };
  return element;
}

const ids = [
  "stage", "scenario", "play", "step", "reset", "speed", "speed-label",
  "relativity", "c-light", "k-coulomb", "merge", "merge-radius", "bounce",
  "bounce-radius", "restitution", "telemetry", "units", "description",
  "events", "trails", "trail-length",
];

const elements = {};
for (const id of ids) {
  elements[id] = makeElement("div");
  elements[id].id = id;
}
const canvas2d = {
  setTransform() {},
  fillRect() {},
  beginPath() {},
  arc() {},
  fill() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  createLinearGradient() {
    return { addColorStop() {} };
  },
};
elements.stage.getContext = () => canvas2d;
elements.scenario.value = "";
elements.stage.clientWidth = 800;
elements.stage.clientHeight = 500;
elements.speed.value = "1";
elements["merge-radius"].value = "0.05";
elements["bounce-radius"].value = "0.2";
elements.restitution.value = "1";
elements["trail-length"].value = "100";
elements.trails.checked = true;

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
};

// Load the same generated data and the studio, which boots against the stub.
(0, eval)(fs.readFileSync(path.join(__dirname, "..", "data", "scenarios.js"), "utf8"));
(0, eval)(fs.readFileSync(path.join(__dirname, "..", "src", "orrery.js"), "utf8"));

function fail(message) {
  console.log(`FAIL ${message}`);
  process.exit(1);
}

function requireOption(count, label) {
  if (elements.scenario.children.length !== count) {
    fail(`${label}: the scenario select holds ${elements.scenario.children.length} entries, expected ${count}`);
  }
}

requireOption(9, "boot");
if (!elements.description.textContent) {
  fail("boot: the description stayed empty");
}
if (!elements.telemetry.textContent.includes("t = ")) {
  fail(`boot: telemetry never rendered (${elements.telemetry.textContent})`);
}
if (!elements.telemetry.textContent.includes("1PN") && !elements.telemetry.textContent.includes("Newtonian")) {
  fail("boot: telemetry does not state the physics mode");
}

// Drive ten animation frames of the opening scenario.
for (let index = 0; index < 10; index++) {
  const queue = rafQueue;
  rafQueue = [];
  for (const callback of queue) {
    callback(performance.now());
  }
}
if (elements.telemetry.textContent.includes("t = 0 ") && rafQueue.length === 0) {
  fail("the animation loop stopped on its own");
}
elements.play.dispatch("click"); // Pause
if (elements.play.textContent !== "Play") {
  fail(`pause: the play button shows ${elements.play.textContent}`);
}

// Step, reset and a scenario switch must all work without throwing.
elements.step.dispatch("click");
elements.reset.dispatch("click");
elements.scenario.value = "pythagorean";
elements.scenario.dispatch("change");
if (!elements.description.textContent.includes("3-4-5")) {
  fail("switch: the description did not follow the scenario");
}
if (!elements.scenario.children.some((option) => option.value === "pythagorean")) {
  fail("switch: the select never gained a pythagorean option");
}

// Merge on a colliding world must log an event without throwing.
elements.scenario.value = "solar";
elements.scenario.dispatch("change");
elements.merge.checked = true;
elements["merge-radius"].disabled = false;
elements.merge.dispatch("change");
for (let index = 0; index < 400; index++) {
  const queue = rafQueue;
  rafQueue = [];
  for (const callback of queue) {
    callback(performance.now());
  }
}

// The relativity switch must restart the world (and never leave a partial state).
elements.bounce.checked = true;
elements.restitution.disabled = false;
elements.restitution.value = "0.8";
elements.bounce.dispatch("change");
elements.relativity.checked = false;
elements.relativity.dispatch("change");
for (let index = 0; index < 20; index++) {
  const queue = rafQueue;
  rafQueue = [];
  for (const callback of queue) {
    callback(performance.now());
  }
}
if (!elements.telemetry.textContent.includes("Newtonian")) {
  fail(`relativity off: telemetry still says ${elements.telemetry.textContent}`);
}
if (globalThis.ORRERY_SCENARIOS.schema !== 1) {
  fail("the embedded scenario data lost its schema marker");
}
console.log("studio smoke: boot, animate, pause, step, reset, switch, relativity and collisions all exercised");
