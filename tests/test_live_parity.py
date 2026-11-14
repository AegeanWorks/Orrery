"""Parity between the sealed browser build and the Python engine.

The live studio at the project root must reproduce the Python engine, so this
test drives the JavaScript core in ``src/orrery.js`` through Node against the
same cases computed here by :mod:`orrery.sim`. Cases are generated fresh on
every run -- nothing is hardcoded -- and the harness under ``tests/`` is the
only Node invocation; if Node is absent the test skips.

Chaotic worlds (figure-eight, pythagorean) amplify the last-ulp differences
between C and JavaScript math beyond exact equality, so each case carries its
own relative tolerance; stable worlds stay far below it.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys_path = str(PROJECT_ROOT)
if sys_path not in __import__("sys").path:
    __import__("sys").path.insert(0, sys_path)

from orrery.scenarios import get_scenario, scenario_keys  # noqa: E402
from orrery.sim import Body, Vec2, World  # noqa: E402

# Relative position tolerance per scenario family, on the final state.
STABLE_TOL = 1e-9
CHAOTIC_TOL = 1e-4


def _body_entry(body: Body) -> dict:
    return {
        "name": body.name,
        "mass": body.mass,
        "x": body.pos.x,
        "y": body.pos.y,
        "vx": body.vel.x,
        "vy": body.vel.y,
        "symbol": body.symbol,
        "color": body.color,
        "charge": body.charge,
    }


def _scenario_case(key: str) -> dict:
    scenario = get_scenario(key)
    tol = CHAOTIC_TOL if key in {"figure-eight", "pythagorean"} else STABLE_TOL
    steps = min(240, int(math.ceil(scenario.span / scenario.dt)))
    return {
        "name": f"scenario:{key}",
        "g": scenario.g,
        "c": scenario.c,
        "k_e": scenario.k_e,
        "dt": scenario.dt,
        "steps": steps,
        "merge_radius": 0.0,
        "bounce_radius": 0.0,
        "restitution": 1.0,
        "tol": tol,
        "initial": [_body_entry(body) for body in scenario.bodies],
    }


def _document(cases: list[dict]) -> dict:
    for case in cases:
        world = World(
            tuple(
                Body(
                    name=entry["name"],
                    mass=entry["mass"],
                    pos=Vec2(entry["x"], entry["y"]),
                    vel=Vec2(entry["vx"], entry["vy"]),
                    symbol=entry["symbol"],
                    color=entry["color"],
                    charge=entry["charge"],
                )
                for entry in case["initial"]
            ),
            case["g"],
            c=case["c"],
            k_e=case["k_e"],
        )
        for _ in range(case["steps"]):
            world.step(case["dt"])
            if case["merge_radius"] > 0.0:
                world.resolve_collisions(case["merge_radius"])
            if case["bounce_radius"] > 0.0:
                world.resolve_elastic_collisions(case["bounce_radius"],
                                                 case["restitution"])
        case["expected"] = {
            "time": world.time,
            "bodies": [_body_entry(body) for body in world.bodies],
        }
    return {"cases": cases}


def build_cases() -> list[dict]:
    cases = [_scenario_case(key) for key in scenario_keys()]
    # A straight-on merge: two equal bodies released toward each other.
    touching = {
        "name": "merge:two-body",
        "g": 1.0,
        "c": None,
        "k_e": 0.0,
        "dt": 0.005,
        "steps": 400,
        "merge_radius": 0.05,
        "bounce_radius": 0.0,
        "restitution": 1.0,
        "tol": STABLE_TOL,
        "initial": _body_entry_batch([
            Body("Heavy", 1.0, Vec2(-0.5, 0.0), Vec2(0.05, 0.0)),
            Body("Light", 1.0, Vec2(0.5, 0.0), Vec2(-0.05, 0.0)),
        ]),
    }
    cases.append(touching)
    bouncing = {
        "name": "bounce:two-body",
        "g": 1e-9,
        "c": None,
        "k_e": 0.0,
        "dt": 0.01,
        "steps": 50,
        "merge_radius": 0.0,
        "bounce_radius": 0.2,
        "restitution": 0.8,
        "tol": STABLE_TOL,
        "initial": _body_entry_batch([
            Body("Left", 2.0, Vec2(-0.05, 0.0), Vec2(0.5, 0.0)),
            Body("Right", 2.0, Vec2(0.05, 0.0), Vec2(-0.5, 0.0)),
        ]),
    }
    cases.append(bouncing)
    return cases


def _body_entry_batch(bodies: list[Body]) -> list[dict]:
    return [_body_entry(body) for body in bodies]


class LiveParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node is unavailable")
    def test_browser_core_matches_the_python_engine(self):
        document = _document(build_cases())
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "parity-cases.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            result = subprocess.run(
                ["node", str(PROJECT_ROOT / "tests" / "live_parity.cjs"), str(path)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
            )
        output = (result.stdout + result.stderr).strip()
        self.assertEqual(
            result.returncode, 0,
            f"the browser core diverged from the Python engine:\n{output}",
        )
        self.assertIn("parity case(s) within tolerance", output)

    @unittest.skipUnless(shutil.which("node"), "node is unavailable")
    def test_studio_boots_and_drives_against_a_dom_stub(self):
        result = subprocess.run(
            ["node", str(PROJECT_ROOT / "tests" / "studio_smoke.cjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        output = (result.stdout + result.stderr).strip()
        self.assertEqual(
            result.returncode, 0,
            f"the studio failed its smoke run:\n{output}",
        )
        self.assertIn("all exercised", output)


if __name__ == "__main__":
    unittest.main()
