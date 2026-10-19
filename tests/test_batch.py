import csv
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from planemeshforge.abaqus_io import ElementBlock, Mesh, read_deck, write_deck
from planemeshforge.core.improve import batch


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


class TestExpandInputs(unittest.TestCase):
    def test_expands_glob_patterns(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "a.inp").write_text("x")
            (tmp / "b.inp").write_text("x")
            (tmp / "c.txt").write_text("x")

            result = batch.expand_inputs([str(tmp / "*.inp")])

            self.assertEqual(sorted(Path(p).name for p in result), ["a.inp", "b.inp"])

    def test_keeps_non_matching_literal_path(self):
        result = batch.expand_inputs(["/nope/does-not-exist.inp"])
        self.assertEqual(result, ["/nope/does-not-exist.inp"])


class TestQualityReport(unittest.TestCase):
    def test_reports_metrics_without_modifying_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mesh.inp"
            write_deck(str(path), _skewed_grid(seed=1))
            original_bytes = path.read_bytes()

            reports = batch.quality_report([str(path)])

            self.assertEqual(len(reports), 1)
            report = reports[0]
            self.assertTrue(report.ok)
            self.assertIn("skewness", report.before)
            self.assertGreater(report.flagged_before, 0)
            self.assertEqual(report.after, {})
            self.assertEqual(path.read_bytes(), original_bytes)

    def test_missing_file_reports_error_without_raising(self):
        reports = batch.quality_report(["/no/such/file.inp"])
        self.assertFalse(reports[0].ok)
        self.assertIn("No such file", reports[0].error or "")


class TestImproveFile(unittest.TestCase):
    def test_improves_and_writes_output_alongside_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            path = tmp / "mesh.inp"
            write_deck(str(path), _skewed_grid(seed=2))

            report = batch.improve_file(str(path), preset="balanced")

            self.assertTrue(report.ok)
            self.assertLess(report.after["skewness"]["mean"], report.before["skewness"]["mean"])
            self.assertLessEqual(report.flagged_after, report.flagged_before)
            output_path = Path(report.output_path)
            self.assertEqual(output_path.parent, tmp)
            self.assertEqual(output_path.name, "mesh_improved.inp")

            reloaded = read_deck(str(output_path))
            self.assertEqual(len(reloaded.point_ids), 36)

    def test_writes_to_outdir_with_custom_suffix(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            path = tmp / "mesh.inp"
            write_deck(str(path), _skewed_grid(seed=3))
            outdir = tmp / "out"

            report = batch.improve_file(str(path), preset="gentle", outdir=str(outdir), suffix="_v2")

            self.assertTrue(report.ok)
            self.assertEqual(Path(report.output_path), outdir / "mesh_v2.inp")
            self.assertTrue((outdir / "mesh_v2.inp").exists())

    def test_custom_steps_are_used_over_preset(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mesh.inp"
            write_deck(str(path), _skewed_grid(seed=4))

            report = batch.improve_file(
                str(path), steps=[{"op": "smooth_nodes", "method": "smart_laplacian", "iterations": 3}]
            )

            self.assertTrue(report.ok)
            self.assertLess(report.after["skewness"]["mean"], report.before["skewness"]["mean"])

    def test_bad_recipe_reports_error_without_raising(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mesh.inp"
            write_deck(str(path), _skewed_grid(seed=5))

            report = batch.improve_file(str(path), steps=[{"op": "delete_nodes", "ids": [1]}])

            self.assertFalse(report.ok)
            self.assertIsNone(report.output_path)


class TestImproveFiles(unittest.TestCase):
    def test_serial_and_parallel_give_the_same_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            paths = []
            for seed in (6, 7, 8):
                path = tmp / f"mesh_{seed}.inp"
                write_deck(str(path), _skewed_grid(seed=seed))
                paths.append(str(path))

            serial = batch.improve_files(paths, jobs=1, preset="balanced")
            parallel = batch.improve_files(paths, jobs=3, preset="balanced")

            self.assertEqual(len(serial), 3)
            self.assertEqual(len(parallel), 3)
            for s, p in zip(serial, parallel):
                self.assertTrue(s.ok and p.ok)
                self.assertAlmostEqual(s.after["skewness"]["mean"], p.after["skewness"]["mean"], places=9)


class TestWriteReport(unittest.TestCase):
    def test_writes_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mesh.inp"
            write_deck(str(path), _skewed_grid(seed=10))
            reports = batch.improve_files([str(path)], preset="gentle")
            report_path = Path(tmp) / "report.csv"

            batch.write_report(reports, str(report_path))

            with open(report_path, newline="") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["path"], str(path))
            self.assertEqual(rows[0]["ok"], "True")

    def test_writes_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mesh.inp"
            write_deck(str(path), _skewed_grid(seed=11))
            reports = batch.improve_files([str(path)], preset="gentle")
            report_path = Path(tmp) / "report.json"

            batch.write_report(reports, str(report_path))

            rows = json.loads(report_path.read_text())
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0]["ok"])


if __name__ == "__main__":
    unittest.main()
