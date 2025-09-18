import unittest
import io
import numpy as np
from unittest.mock import patch

from abaqus_io.deck_utility import (
    _get_option_map,
    _read_nodes,
    _read_cells,
    _read_set,
)


class TestGetOptionMap(unittest.TestCase):

    def test_basic_parsing(self):
        line = "elset,instance=dummy2,generate"
        expected = {"ELSET": None, "INSTANCE": "dummy2", "GENERATE": None}
        self.assertEqual(_get_option_map(line), expected)

    def test_keys_without_values(self):
        line = "part,assembly,generate"
        expected = {"PART": None, "ASSEMBLY": None, "GENERATE": None}
        self.assertEqual(_get_option_map(line), expected)

    def test_required_keys_present(self):
        line = "elset,instance=dummy2,generate"
        required = ["INSTANCE"]
        expected = {"ELSET": None, "INSTANCE": "dummy2", "GENERATE": None}
        self.assertEqual(_get_option_map(line, required_keys=required), expected)

    def test_required_keys_missing(self):
        line = "elset,generate"
        required = ["INSTANCE"]
        with self.assertRaisesRegex(
            ValueError, "Missing required keys: INSTANCE in line: 'elset,generate'"
        ):
            _get_option_map(line, required_keys=required)

    def test_empty_parts(self):
        line = "elset,,instance=dummy2,,generate"
        expected = {"ELSET": None, "INSTANCE": "dummy2", "GENERATE": None}
        self.assertEqual(_get_option_map(line), expected)

    def test_case_insensitivity_keys(self):
        line = "ElSeT,InStAnCe=dummy2,GeNeRaTe"
        expected = {"ELSET": None, "INSTANCE": "dummy2", "GENERATE": None}
        self.assertEqual(_get_option_map(line), expected)

    def test_value_with_equals_sign(self):
        line = "param=value=with=equals,another=one"
        expected = {"PARAM": "value=with=equals", "ANOTHER": "one"}
        self.assertEqual(_get_option_map(line), expected)

    def test_empty_line(self):
        line = ""
        expected = {}
        self.assertEqual(_get_option_map(line), expected)

    def test_only_required_keys(self):
        line = "instance=dummy"
        required = ["INSTANCE"]
        expected = {"INSTANCE": "dummy"}
        self.assertEqual(_get_option_map(line, required_keys=required), expected)

    def test_required_keys_case_insensitivity(self):
        line = "elset,instance=dummy2,generate"
        required = ["instance"]  # Lowercase required key
        expected = {"ELSET": None, "INSTANCE": "dummy2", "GENERATE": None}
        self.assertEqual(_get_option_map(line, required_keys=required), expected)


class TestReadNodes(unittest.TestCase):

    def test_basic_read_nodes(self):
        input_data = io.StringIO(
            "1, 0.0, 0.0, 0.0\n"
            "2, 1.0, 0.0, 0.0\n"
            "3, 0.0, 1.0, 0.0\n"
            "*ELEMENT, TYPE=C3D8"
        )
        options_map = {}
        nodes, nodes_ids, node_sets, last_line = _read_nodes(input_data, options_map)

        expected_nodes = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        expected_nodes_ids = [1, 2, 3]
        expected_node_sets = {}
        expected_last_line = "*ELEMENT, TYPE=C3D8"

        np.testing.assert_array_almost_equal(nodes, expected_nodes)
        self.assertEqual(nodes_ids, expected_nodes_ids)
        self.assertEqual(node_sets, expected_node_sets)
        self.assertEqual(last_line.strip(), expected_last_line.strip())

    def test_read_nodes_with_nset(self):
        input_data = io.StringIO(
            "1, 0.0, 0.0, 0.0\n" "2, 1.0, 0.0, 0.0\n" "*ELEMENT, TYPE=C3D8"
        )
        options_map = {"NSET": "MY_NODES"}
        nodes, nodes_ids, node_sets, last_line = _read_nodes(input_data, options_map)

        expected_node_sets = {"MY_NODES": [1, 2]}
        self.assertTrue("MY_NODES" in node_sets)
        self.assertEqual(node_sets["MY_NODES"], expected_node_sets["MY_NODES"])

    def test_read_nodes_empty_input(self):
        input_data = io.StringIO("*ELEMENT, TYPE=C3D8")
        options_map = {}
        nodes, nodes_ids, node_sets, last_line = _read_nodes(input_data, options_map)

        self.assertEqual(nodes.shape, (0, 3))
        self.assertEqual(nodes_ids, [])
        self.assertEqual(node_sets, {})
        self.assertEqual(last_line.strip(), "*ELEMENT, TYPE=C3D8".strip())

    def test_read_nodes_with_comments_and_empty_lines(self):
        input_data = io.StringIO(
            "** This is a comment\n"
            "\n"
            "1, 0.0, 0.0, 0.0\n"
            "** Another comment\n"
            "2, 1.0, 0.0, 0.0\n"
            "*ELEMENT, TYPE=C3D8"
        )
        options_map = {}
        nodes, nodes_ids, node_sets, last_line = _read_nodes(input_data, options_map)

        expected_nodes = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]])
        expected_nodes_ids = [1, 2]

        np.testing.assert_array_almost_equal(nodes, expected_nodes)
        self.assertEqual(nodes_ids, expected_nodes_ids)

    def test_read_nodes_malformed_line_value_error(self):
        input_data = io.StringIO("1, 0.0, 0.0, abc\n")
        options_map = {}
        with self.assertRaisesRegex(
            ValueError,
            "Malformed node line: '1, 0.0, 0.0, abc'. Error: could not convert string to float: 'abc'",
        ):
            _read_nodes(input_data, options_map)

    def test_read_nodes_malformed_line_index_error(self):
        input_data = io.StringIO("1\n")
        options_map = {}
        with self.assertRaisesRegex(
            ValueError, r"Node 1 does not have 3 coordinates: \[\]"
        ):
            _read_nodes(input_data, options_map)

    def test_read_nodes_incorrect_coordinate_count(self):
        input_data = io.StringIO("1, 0.0, 0.0\n")
        options_map = {}
        with self.assertRaisesRegex(
            ValueError, r"Node 1 does not have 3 coordinates: \[0.0, 0.0\]"
        ):
            _read_nodes(input_data, options_map)


class TestReadCells(unittest.TestCase):

    def setUp(self):
        # Mock _config for testing _read_cells
        self.mock_config = {
            "C3D8": {"dim": 3, "nodes": 8},
            "C3D4": {"dim": 3, "nodes": 4},
        }
        self.patcher = patch("abaqus_io.deck_utility._config", self.mock_config)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()

    def test_basic_read_cells(self):
        input_data = io.StringIO(
            "1, 1, 2, 3, 4, 5, 6, 7, 8\n" "2, 8, 7, 6, 5, 4, 3, 2, 1\n" "*NODE"
        )
        options_map = {"TYPE": "C3D8"}
        point_ids = [[1, 2, 3, 4, 5, 6, 7, 8]]
        cells, cell_ids, elem_sets, last_line = _read_cells(
            input_data, options_map, point_ids
        )

        expected_cells = np.array(
            [[1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]], dtype=np.int32
        )
        expected_cell_ids = [1, 2]
        expected_elem_sets = {}
        expected_last_line = "*NODE"

        np.testing.assert_array_equal(cells, expected_cells)
        self.assertEqual(cell_ids, expected_cell_ids)
        self.assertEqual(elem_sets, expected_elem_sets)
        self.assertEqual(last_line.strip(), expected_last_line.strip())

    def test_read_cells_with_elset(self):
        input_data = io.StringIO("1, 1, 2, 3, 4\n" "2, 5, 6, 7, 8\n" "*NODE")
        options_map = {"TYPE": "C3D4", "ELSET": "MY_ELEMENTS"}
        point_ids = [[1, 2, 3, 4, 5, 6, 7, 8]]
        cells, cell_ids, elem_sets, last_line = _read_cells(
            input_data, options_map, point_ids
        )

        expected_elem_sets = {"MY_ELEMENTS": [1, 2]}
        self.assertTrue("MY_ELEMENTS" in elem_sets)
        self.assertEqual(elem_sets["MY_ELEMENTS"], expected_elem_sets["MY_ELEMENTS"])

    def test_read_cells_empty_input(self):
        input_data = io.StringIO("*NODE")
        options_map = {"TYPE": "C3D8"}
        point_ids = []
        cells, cell_ids, elem_sets, last_line = _read_cells(
            input_data, options_map, point_ids
        )

        self.assertEqual(cells.shape[0], 0)
        self.assertEqual(cell_ids, [])
        self.assertEqual(elem_sets, {})
        self.assertEqual(last_line.strip(), "*NODE".strip())

    def test_read_cells_with_comments_and_empty_lines(self):
        input_data = io.StringIO(
            "** This is a comment\n"
            "\n"
            "1, 1, 2, 3, 4, 5, 6, 7, 8\n"
            "** Another comment\n"
            "2, 8, 7, 6, 5, 4, 3, 2, 1\n"
            "*NODE"
        )
        options_map = {"TYPE": "C3D8"}
        point_ids = [[1, 2, 3, 4, 5, 6, 7, 8]]
        cells, cell_ids, elem_sets, last_line = _read_cells(
            input_data, options_map, point_ids
        )

        expected_cells = np.array(
            [[1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]], dtype=np.int32
        )
        expected_cell_ids = [1, 2]

        np.testing.assert_array_equal(cells, expected_cells)
        self.assertEqual(cell_ids, expected_cell_ids)

    def test_read_cells_malformed_line_value_error(self):
        input_data = io.StringIO("1, 1, 2, 3, abc\n")
        options_map = {"TYPE": "C3D4"}
        point_ids = [[1, 2, 3]]
        with self.assertRaisesRegex(
            ValueError,
            r"Malformed cell line: '1, 1, 2, 3, abc'. Error: invalid literal for int\(\) with base 10: 'abc'",
        ):
            _read_cells(input_data, options_map, point_ids)

    def test_read_cells_malformed_line_index_error(self):
        input_data = io.StringIO("1\n")
        options_map = {"TYPE": "C3D4"}
        point_ids = []
        with self.assertRaisesRegex(
            ValueError, r"Element 1 of type C3D4 expects 4 nodes, but got 0: \[\]"
        ):
            _read_cells(input_data, options_map, point_ids)

    def test_read_cells_incorrect_node_count(self):
        input_data = io.StringIO("1, 1, 2, 3\n")
        options_map = {"TYPE": "C3D8"}
        point_ids = [[1, 2, 3]]
        with self.assertRaisesRegex(
            ValueError,
            r"Element 1 of type C3D8 expects 8 nodes, but got 3: \[1, 2, 3\]",
        ):
            _read_cells(input_data, options_map, point_ids)

    def test_read_cells_unsupported_element_type(self):
        input_data = io.StringIO("1, 1, 2, 3, 4\n")
        options_map = {"TYPE": "UNSUPPORTED_TYPE"}
        point_ids = [[1, 2, 3, 4]]
        with self.assertRaisesRegex(
            ValueError, "Element type not available or misconfigured: UNSUPPORTED_TYPE"
        ):
            _read_cells(input_data, options_map, point_ids)

    def test_read_cells_undefined_node(self):
        input_data = io.StringIO("1, 1, 2, 3, 99\n")  # Node 99 is not in point_ids
        options_map = {"TYPE": "C3D4"}
        point_ids = [[1, 2, 3, 4]]
        with self.assertRaisesRegex(
            ValueError,
            "Element 1 references undefined node IDs: 99",
        ):
            _read_cells(input_data, options_map, point_ids)


class TestReadSet(unittest.TestCase):

    def test_read_set_numeric_ids(self):
        input_data = io.StringIO("1, 2, 3\n" "4, 5\n" "*NODE")
        options_map = {}
        set_ids, set_names, last_line = _read_set(input_data, options_map)

        expected_set_ids = [1, 2, 3, 4, 5]
        expected_set_names = []
        expected_last_line = "*NODE"

        self.assertEqual(set_ids, expected_set_ids)
        self.assertEqual(set_names, expected_set_names)
        self.assertEqual(last_line.strip(), expected_last_line.strip())

    def test_read_set_named_ids(self):
        input_data = io.StringIO("SET_A, SET_B\n" "SET_C\n" "*NODE")
        options_map = {}
        set_ids, set_names, last_line = _read_set(input_data, options_map)

        expected_set_ids = []
        expected_set_names = ["SET_A", "SET_B", "SET_C"]
        expected_last_line = "*NODE"

        self.assertEqual(set_ids, expected_set_ids)
        self.assertEqual(set_names, expected_set_names)
        self.assertEqual(last_line.strip(), expected_last_line.strip())

    def test_read_set_mixed_ids_and_names(self):
        input_data = io.StringIO("1, 2, SET_A\n" "*NODE")
        options_map = {}
        set_ids, set_names, last_line = _read_set(input_data, options_map)

        expected_set_ids = []
        expected_set_names = ["1", "2", "SET_A"]
        expected_last_line = "*NODE"

        self.assertEqual(set_ids, expected_set_ids)
        self.assertEqual(set_names, expected_set_names)
        self.assertEqual(last_line.strip(), expected_last_line.strip())

    def test_read_set_empty_input(self):
        input_data = io.StringIO("*NODE")
        options_map = {}
        set_ids, set_names, last_line = _read_set(input_data, options_map)

        self.assertEqual(set_ids, [])
        self.assertEqual(set_names, [])
        self.assertEqual(last_line.strip(), "*NODE".strip())

    def test_read_set_with_comments_and_empty_lines(self):
        input_data = io.StringIO(
            "** Comment\n" "\n" "1, 2, 3\n" "** Another comment\n" "4, 5\n" "*NODE"
        )
        options_map = {}
        set_ids, set_names, last_line = _read_set(input_data, options_map)

        expected_set_ids = [1, 2, 3, 4, 5]
        self.assertEqual(set_ids, expected_set_ids)

    def test_read_set_generate_option(self):
        input_data = io.StringIO("1, 5, 1\n" "*NODE")
        options_map = {"GENERATE": None}
        set_ids, set_names, last_line = _read_set(input_data, options_map)

        expected_set_ids = [1, 2, 3, 4, 5]
        self.assertEqual(set_ids, expected_set_ids)

    def test_read_set_generate_option_invalid_count(self):
        input_data = io.StringIO("1, 5\n" "*NODE")
        options_map = {"GENERATE": None}
        with self.assertRaisesRegex(
            ValueError,
            r"GENERATE option requires 3 values \(start, end, increment\), but got 2: \[1, 5\]",
        ):
            _read_set(input_data, options_map)


if __name__ == "__main__":
    unittest.main()
