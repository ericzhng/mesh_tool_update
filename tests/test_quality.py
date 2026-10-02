import unittest

import numpy as np

from planemeshforge.abaqus_io import ElementBlock, Mesh
from planemeshforge.core import quality


class TestQuality(unittest.TestCase):
    def test_no_issues_on_clean_mesh(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [1, 3, 4]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[tri])
        self.assertEqual(quality.check(mesh), [])

    def test_inverted_element_detected(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        # 1, 3, 2 is the reverse winding of 1, 2, 3 -> negative signed area
        tri = ElementBlock("CGAX3", [1], [[1, 3, 2]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        issues = quality.check(mesh)
        self.assertTrue(any(i["kind"] == "inverted_element" for i in issues))

    def test_orphan_node_detected(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [5.0, 5.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[tri])
        issues = quality.check(mesh)
        orphan = [i for i in issues if i["kind"] == "orphan_node"]
        self.assertEqual(len(orphan), 1)
        self.assertEqual(orphan[0]["node_ids"], [4])

    def test_duplicate_element_detected(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        issues = quality.check(mesh)
        self.assertTrue(any(i["kind"] == "duplicate_element" for i in issues))

    def test_empty_mesh(self):
        self.assertEqual(quality.check(None), [])


class TestMetrics(unittest.TestCase):
    def test_unit_square_quad(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]])
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[quad])
        result = quality.metrics(mesh)
        elem = result["elements"][0]
        self.assertAlmostEqual(elem["skewness"], 0.0, places=6)
        self.assertAlmostEqual(elem["aspect_ratio"], 1.0, places=6)
        self.assertAlmostEqual(elem["min_angle"], 90.0, places=6)
        self.assertAlmostEqual(elem["max_angle"], 90.0, places=6)
        self.assertAlmostEqual(elem["area"], 1.0, places=6)

    def test_equilateral_triangle(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.5, np.sqrt(3) / 2, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        elem = quality.metrics(mesh)["elements"][0]
        self.assertAlmostEqual(elem["skewness"], 0.0, places=6)
        self.assertAlmostEqual(elem["min_angle"], 60.0, places=6)
        self.assertAlmostEqual(elem["max_angle"], 60.0, places=6)

    def test_sliver_triangle_is_heavily_skewed(self):
        # A needle triangle: one edge (p2-p1) is far shorter than the other two.
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.001, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        elem = quality.metrics(mesh)["elements"][0]
        self.assertGreater(elem["skewness"], 0.9)
        self.assertGreater(elem["aspect_ratio"], 10)

    def test_degenerate_triangle_does_not_crash(self):
        # Collinear nodes: zero area, but no zero-length edge.
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        elem = quality.metrics(mesh)["elements"][0]
        self.assertEqual(elem["skewness"], 1.0)
        self.assertAlmostEqual(elem["area"], 0.0, places=6)

    def test_zero_length_edge_reports_no_aspect_ratio(self):
        # Two coincident nodes collapse one edge to zero length.
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])
        elem = quality.metrics(mesh)["elements"][0]
        self.assertEqual(elem["skewness"], 1.0)
        self.assertIsNone(elem["aspect_ratio"])

    def test_empty_mesh(self):
        self.assertEqual(quality.metrics(None), {"elements": [], "summary": {}})


if __name__ == "__main__":
    unittest.main()
