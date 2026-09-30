import tempfile
import unittest
from pathlib import Path

import numpy as np

from planemeshforge.abaqus_io.deck_read import read_deck
from planemeshforge.abaqus_io.deck_write import write_deck

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DECK_PATH_READ = DATA_DIR / "geometry-backup.deck"


@unittest.skipUnless(DECK_PATH_READ.exists(), f"{DECK_PATH_READ} not present in this checkout")
class TestAbaqusDeckIO(unittest.TestCase):

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.deck_path_write = Path(self._tmpdir.name) / "geometry-backup_rewrite.inp"

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_read_abaqus(self):
        read_deck(DECK_PATH_READ)

    def test_write_abaqus(self):
        mesh_data = read_deck(DECK_PATH_READ)
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
