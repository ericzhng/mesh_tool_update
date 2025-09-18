import unittest
import os

# from abaqus_io import read_deck, write_deck
from abaqus_io.mesh_io import Mesh


class TestAbaqusDeckIO(unittest.TestCase):

    def setUp(self):
        self.deck_path_read = os.path.join("data", "geometry-backup.deck")
        self.deck_path_write = "geometry-compare.inp"
        self.mesh_data = None

    def tearDown(self):
        pass

    def test_read_abaqus(self):
        self.mesh_data = Mesh.from_file(self.deck_path_read)

    def test_write_abaqus(self):
        if self.mesh_data is None:
            self.mesh_data = Mesh.from_file(self.deck_path_read)

        self.mesh_data.write(self.deck_path_write)


if __name__ == "__main__":
    unittest.main()
