import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

from planemeshforge.abaqus_io import ElementBlock, Mesh, write_deck
from planemeshforge.cli import main


def _skewed_grid(seed: int, n: int = 5, jitter: float = 0.4) -> Mesh:
    rng = np.random.default_rng(seed)
    ids = {}
    points = []
    pid = 1
    for j in range(n + 1):
        for i in range(n + 1):
            ids[(i, j)] = pid
            x, y = float(i) / n, float(j) / n
            boundary = i in (0, n) or j in (0, n)
            if not boundary:
                x += rng.uniform(-jitter, jitter) / n
                y += rng.uniform(-jitter, jitter) / n
            points.append([x, y, 0.0])
            pid += 1
    conn = []
    for j in range(n):
        for i in range(n):
            a, b, c, d = ids[(i, j)], ids[(i + 1, j)], ids[(i + 1, j + 1)], ids[(i, j + 1)]
            conn.append([a, b, c])
            conn.append([a, c, d])
    tri = ElementBlock("CGAX3", list(range(1, len(conn) + 1)), conn)
    return Mesh(points=np.array(points), point_ids=list(ids.values()), cells=[tri])


def _run_cli(argv):
    old_argv = sys.argv
    sys.argv = ["planemeshforge", *argv]
    try:
        return main()
    finally:
        sys.argv = old_argv


class TestCliImproveAndQuality(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.mesh_path = self.tmp / "mesh.inp"
        write_deck(str(self.mesh_path), _skewed_grid(seed=42))

    def tearDown(self):
        self._tmp.cleanup()

    def test_quality_command_exits_zero_on_success(self):
        exit_code = _run_cli(["quality", str(self.mesh_path)])
        self.assertEqual(exit_code, 0)

    def test_quality_fail_under_gates_with_nonzero_exit(self):
        exit_code = _run_cli(["quality", str(self.mesh_path), "--fail-under", "0.1"])
        self.assertEqual(exit_code, 1)

    def test_quality_command_with_no_matches_exits_nonzero(self):
        exit_code = _run_cli(["quality", str(self.tmp / "nothing-*.inp")])
        self.assertEqual(exit_code, 1)

    def test_improve_command_writes_output_and_report(self):
        report_path = self.tmp / "report.csv"
        exit_code = _run_cli(
            ["improve", str(self.mesh_path), "--preset", "balanced", "-o", str(self.tmp / "out"), "--report", str(report_path)]
        )
        self.assertEqual(exit_code, 0)
        self.assertTrue((self.tmp / "out" / "mesh_improved.inp").exists())
        self.assertTrue(report_path.exists())

    def test_improve_command_with_recipe_file(self):
        recipe_path = self.tmp / "recipe.yaml"
        recipe_path.write_text("- op: smooth_nodes\n  method: smart_laplacian\n  iterations: 5\n")
        exit_code = _run_cli(["improve", str(self.mesh_path), "--recipe", str(recipe_path), "-o", str(self.tmp / "out2")])
        self.assertEqual(exit_code, 0)
        self.assertTrue((self.tmp / "out2" / "mesh_improved.inp").exists())

    def test_preset_and_recipe_are_mutually_exclusive(self):
        with self.assertRaises(SystemExit) as ctx:
            _run_cli(["improve", str(self.mesh_path), "--preset", "balanced", "--recipe", "x.yaml"])
        self.assertEqual(ctx.exception.code, 2)

    def test_improve_command_bad_file_sets_nonzero_exit(self):
        exit_code = _run_cli(["improve", str(self.tmp / "missing.inp")])
        self.assertEqual(exit_code, 1)


if __name__ == "__main__":
    unittest.main()
