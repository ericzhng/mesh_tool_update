import unittest
from pathlib import Path

from planemeshforge.abaqus_io import read_deck
from planemeshforge.core.serialize import dict_to_mesh, element_type_registry, mesh_summary, mesh_to_dict

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


class TestSerialize(unittest.TestCase):
    def test_round_trip_on_sample_mesh(self):
        mesh = read_deck(DATA_DIR / "simple_mesh.inp")
        as_dict = mesh_to_dict(mesh)
        rebuilt = dict_to_mesh(as_dict)

        self.assertEqual(len(rebuilt.point_ids), len(mesh.point_ids))
        self.assertEqual(sorted(rebuilt.point_ids), sorted(mesh.point_ids))
        self.assertEqual(sum(len(b) for b in rebuilt.cells), sum(len(b) for b in mesh.cells))

    def test_mesh_to_dict_none(self):
        result = mesh_to_dict(None)
        self.assertEqual(result["nodes"], [])
        self.assertEqual(result["elements"], [])

    def test_dict_to_mesh_empty(self):
        self.assertIsNone(dict_to_mesh({}))
        self.assertIsNone(dict_to_mesh(None))

    def test_mesh_summary_none(self):
        summary = mesh_summary(None)
        self.assertEqual(summary["num_nodes"], 0)

    def test_mesh_summary_counts(self):
        mesh = read_deck(DATA_DIR / "simple_mesh.inp")
        summary = mesh_summary(mesh)
        self.assertEqual(summary["num_nodes"], len(mesh.points))
        self.assertEqual(summary["num_elements"], sum(len(b) for b in mesh.cells))

    def test_element_type_registry_has_expected_types(self):
        registry = element_type_registry()
        self.assertIn("CGAX3", registry)
        self.assertIn("CGAX4", registry)
        self.assertIn("SFMGAX1", registry)
        self.assertEqual(registry["CGAX3"]["nodes"], 3)


if __name__ == "__main__":
    unittest.main()
