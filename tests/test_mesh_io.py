import unittest
import os
import numpy as np

from abaqus_io.deck_read import read_deck
from abaqus_io.deck_write import write_deck
from abaqus_io.mesh_io import Mesh


class TestAbaqusDeckIO(unittest.TestCase):

    def setUp(self):
        self.deck_path_read = os.path.join("data", "simple_mesh.inp")
        self.deck_path_write = "geometry-compare.inp"

    def tearDown(self):
        if os.path.exists(self.deck_path_write):
            os.remove(self.deck_path_write)

    def test_read_abaqus(self):
        mesh_data = read_deck(self.deck_path_read)
        self.assertEqual(len(mesh_data.points), 4)
        self.assertEqual(len(mesh_data.cells), 1)
        self.assertEqual(len(mesh_data.cells[0]), 2)
        self.assertEqual(mesh_data.cells[0].element_type, "CGAX3")

    def test_write_abaqus(self):
        mesh_data = read_deck(self.deck_path_read)
        write_deck(self.deck_path_write, mesh_data)

        mesh_data_read_back = read_deck(self.deck_path_write)

        self.assertEqual(len(mesh_data.points), len(mesh_data_read_back.points))
        self.assertEqual(len(mesh_data.cells), len(mesh_data_read_back.cells))
        self.assertEqual(len(mesh_data.cells[0]), len(mesh_data_read_back.cells[0]))
        self.assertEqual(
            mesh_data.cells[0].element_type, mesh_data_read_back.cells[0].element_type
        )
        np.testing.assert_array_almost_equal(
            mesh_data.points, mesh_data_read_back.points
        )


if __name__ == "__main__":
    unittest.main()
