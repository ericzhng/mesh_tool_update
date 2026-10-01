import unittest

import numpy as np

from planemeshforge.abaqus_io import ElementBlock, Mesh
from planemeshforge.core import topology as topo


class TestOrientCcw(unittest.TestCase):
    def test_reverses_clockwise_triangle(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 3, 2]])  # clockwise
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])

        fixed = topo.orient_ccw(mesh)

        self.assertEqual(fixed, [1])
        np.testing.assert_array_equal(mesh.cells[0].connectivity[0], [1, 2, 3])

    def test_reverses_clockwise_quad(self):
        points = np.array([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 1.0, 0.0], [1.0, 0.0, 0.0]])
        quad = ElementBlock("CGAX4", [1], [[1, 2, 3, 4]])  # clockwise
        mesh = Mesh(points=points, point_ids=[1, 2, 3, 4], cells=[quad])

        fixed = topo.orient_ccw(mesh)

        self.assertEqual(fixed, [1])
        np.testing.assert_array_equal(mesh.cells[0].connectivity[0], [1, 4, 3, 2])

    def test_leaves_ccw_elements_unchanged(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])  # already counter-clockwise
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])

        fixed = topo.orient_ccw(mesh)

        self.assertEqual(fixed, [])
        np.testing.assert_array_equal(mesh.cells[0].connectivity[0], [1, 2, 3])

    def test_leaves_zero_area_element_unchanged(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
        tri = ElementBlock("CGAX3", [1], [[1, 2, 3]])  # collinear
        mesh = Mesh(points=points, point_ids=[1, 2, 3], cells=[tri])

        fixed = topo.orient_ccw(mesh)

        self.assertEqual(fixed, [])
        np.testing.assert_array_equal(mesh.cells[0].connectivity[0], [1, 2, 3])

    def test_leaves_1d_elements_untouched(self):
        points = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
        line = ElementBlock("SFMGAX1", [1], [[1, 2]])
        mesh = Mesh(points=points, point_ids=[1, 2], cells=[line])

        fixed = topo.orient_ccw(mesh)

        self.assertEqual(fixed, [])
        np.testing.assert_array_equal(mesh.cells[0].connectivity[0], [1, 2])


if __name__ == "__main__":
    unittest.main()
