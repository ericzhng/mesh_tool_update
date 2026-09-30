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


if __name__ == "__main__":
    unittest.main()
