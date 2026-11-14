"""Parity between the sealed build's upload validator and the Python loader.

A custom scenario uploaded in the sealed static build is validated in-process
by ``ORRERY_CORE.validateScenarioDocument``. This test drives that function
through Node with documents that exercise every rule of
:mod:`orrery.custom`, computes the expected verdicts with the real
:func:`orrery.custom.load_scenario_file` on temp files, and requires the same
accept/reject verdict plus the same first error line. If Node is absent the
test skips.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from orrery.custom import load_scenario_file  # noqa: E402


def _base_document() -> dict:
    return {
        "g": 1.0,
        "dt": 0.005,
        "span": 4.0,
        "extent": [2.5, 2.5],
        "bodies": [
            {
                "name": "Heavy",
                "mass": 1.0,
                "position": [-0.5, 0.0],
                "velocity": [0.05, 0.0],
                "symbol": "H",
                "color": "orange",
            },
            {
                "name": "Light",
                "mass": 1.0,
                "position": [0.5, 0.0],
                "velocity": [-0.05, 0.0],
                "symbol": "L",
                "color": "cyan",
                "charge": 0.5,
            },
        ],
    }


def _mutated(mutations: dict, name: str) -> dict:
    document = _base_document()
    for key, value in mutations.items():
        if value is _DELETE:
            document.pop(key, None)
        else:
            document[key] = value
    return {"name": name, "text": json.dumps(document)}


class _Delete:
    pass


_DELETE = _Delete()


def _cases() -> list[dict]:
    valid_extra = {
        "steps_per_frame": 2,
        "trail_length": 5000,
        "c": 30.0,
        "k_e": 0.25,
        "key": "duo",
        "title": "Duo Study",
        "description": "Two amber worlds.",
        "units": {
            "time": "T",
            "distance": "au",
            "mass": "Msun",
            "speed": "au/T",
            "speed_scale": 2.5,
        },
    }
    return [
        _mutated({}, "valid-minimal"),
        _mutated(valid_extra, "valid-override-everything"),
        _mutated({"g": 0.0}, "reject-non-positive-g"),
        _mutated({"dt": True}, "reject-boolean-dt"),
        _mutated({"span": "fast"}, "reject-string-span"),
        _mutated({"extent": [1.0]}, "reject-one-axis-extent"),
        _mutated({"extent": [-2.0, 2.5]}, "reject-negative-extent"),
        _mutated({"bodies": []}, "reject-empty-bodies"),
        _mutated({"bodies": [{"name": f"B{index}", "mass": 1.0,
                              "position": [0.0, 0.0], "velocity": [0.0, 0.0],
                              "symbol": chr(65 + index % 26)}
                             for index in range(65)]}, "reject-65-bodies"),
        _mutated({"bodies": [
            {"name": "Twin", "mass": 1.0, "position": [0.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "T"},
            {"name": "Twin", "mass": 2.0, "position": [1.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "S"},
        ]}, "reject-duplicate-name"),
        _mutated({"bodies": [
            {"name": "One", "mass": 1.0, "position": [0.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "T"},
            {"name": "Two", "mass": 2.0, "position": [1.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "T"},
        ]}, "reject-duplicate-symbol"),
        _mutated({"bodies": [
            {"name": "A", "mass": 1.0, "position": [0.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "  "},
        ]}, "reject-space-symbol"),
        _mutated({"bodies": [
            {"name": "A", "mass": 1.0, "position": [0.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "A", "color": "chartreuse"},
        ]}, "reject-unknown-color"),
        _mutated({"bodies": [
            {"name": "A", "mass": -3.0, "position": [0.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "A"},
        ]}, "reject-negative-mass"),
        _mutated({"bodies": [
            {"name": "A\nB", "mass": 1.0, "position": [0.0, 0.0],
             "velocity": [0.0, 0.0], "symbol": "A"},
        ]}, "reject-control-character-in-name"),
        _mutated({"key": "x" * 65}, "reject-overlong-key"),
        _mutated({"units": {"speed_scale": 0.0}}, "reject-zero-speed-scale"),
        _mutated({"k_e": -0.5}, "reject-negative-coulomb"),
        {"name": "reject-not-json", "text": "{\"g\": 1.0,"},
    ]


def _expected(cases: list[dict]) -> dict:
    for case in cases:
        folder = tempfile.mkdtemp(prefix="orrery-custom-parity-")
        path = Path(folder) / "scenario.json"
        try:
            path.write_text(case["text"], encoding="utf-8")
            scenario = load_scenario_file(path)
            case["valid"] = True
            if "key" in json.loads(case["text"]):
                case["key"] = scenario.key
        except Exception as error:  # noqa: BLE001 - the loader reports every miss
            case["valid"] = False
            first_line = str(error).splitlines()[0]
            # The loader embeds the temp file path it was handed; the sealed
            # build validates an in-memory upload that has no path, so only
            # the stable phrase survives the comparison.
            if " is not valid JSON:" in first_line:
                first_line = "the uploaded scenario is not valid JSON"
            case["error"] = first_line
        finally:
            shutil.rmtree(folder, ignore_errors=True)
    return {"cases": cases}


class CustomSealedParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node is unavailable")
    def test_sealed_validator_matches_the_python_loader(self):
        cases = _cases()
        document = _expected(cases)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "validator-cases.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            result = subprocess.run(
                ["node", str(PROJECT_ROOT / "tests" / "custom_validate.cjs"), str(path)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
            )
        output = (result.stdout + result.stderr).strip()
        self.assertEqual(
            result.returncode, 0,
            f"the sealed validator diverged from the Python loader:\n{output}",
        )
        self.assertIn("validator case(s) in parity", output)


if __name__ == "__main__":
    unittest.main()
