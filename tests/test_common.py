import unittest
import numpy as np
from abaqus_io import _common
import io
import contextlib


class TestCommon(unittest.TestCase):

    def test_unflatten_cell_data(self):
        block_counts = [3, 2, 4]
        flat_cell_data = {
            "data1": np.array([10, 11, 12, 13, 14, 15, 16, 17, 18]),
            "data2": np.array([20, 21, 22, 23, 24, 25, 26, 27, 28]),
        }

        unflattened_data = _common.unflatten_cell_data(flat_cell_data, block_counts)

        self.assertEqual(len(unflattened_data["data1"]), 3)
        self.assertTrue(
            np.array_equal(unflattened_data["data1"][0], np.array([10, 11, 12]))
        )
        self.assertTrue(
            np.array_equal(unflattened_data["data1"][1], np.array([13, 14]))
        )
        self.assertTrue(
            np.array_equal(unflattened_data["data1"][2], np.array([15, 16, 17, 18]))
        )

    def test_flatten_cell_data(self):
        structured_cell_data = {
            "data1": [
                np.array([10, 11, 12]),
                np.array([13, 14]),
                np.array([15, 16, 17, 18]),
            ],
            "data2": [
                np.array([20, 21, 22]),
                np.array([23, 24]),
                np.array([25, 26, 27, 28]),
            ],
        }

        flattened_data = _common.flatten_cell_data(structured_cell_data)

        self.assertTrue(
            np.array_equal(
                flattened_data["data1"], np.array([10, 11, 12, 13, 14, 15, 16, 17, 18])
            )
        )
        self.assertTrue(
            np.array_equal(
                flattened_data["data2"], np.array([20, 21, 22, 23, 24, 25, 26, 27, 28])
            )
        )

    def test_unflatten_cell_data_with_invalid_dimensions(self):
        block_counts = [3, 2, 4]
        flat_cell_data = {
            "data1": np.array([10, 11, 12, 13, 14, 15, 16, 17]),
        }
        with self.assertRaises(ValueError):
            _common.unflatten_cell_data(flat_cell_data, block_counts)

    def test_is_substring_in_any(self):
        self.assertTrue(_common.is_substring_in_any("a", ["apple", "banana", "orange"]))
        self.assertFalse(
            _common.is_substring_in_any("z", ["apple", "banana", "orange"])
        )

    def test_join_split_strings(self):
        strings = ["hello", "world"]
        joined_string, separator = _common.join_strings_with_separator(strings)
        self.assertEqual(joined_string, f"hello{separator}world")

        split_strings = _common.split_string_by_separator(joined_string, separator)
        self.assertEqual(strings, split_strings)

        with self.assertRaises(ValueError):
            _common.join_strings_with_separator(["a-b", "c_d", "e#f", "g+h", "i/j"])

    def test_replace_spaces(self):
        string = "hello world"
        new_string, char = _common.replace_spaces_with_char(string)
        self.assertEqual(new_string, f"hello{char}world")

        with self.assertRaises(ValueError):
            _common.replace_spaces_with_char("a_b-c+dXe/f#g")


class TestLoggingFunctions(unittest.TestCase):
    def test_info(self):
        f = io.StringIO()
        with contextlib.redirect_stderr(f):
            _common.info("test message")
        s = f.getvalue()
        self.assertIn("Info", s)
        self.assertIn("test message", s)

    def test_warning(self):
        f = io.StringIO()
        with contextlib.redirect_stderr(f):
            _common.warning("test message")
        s = f.getvalue()
        self.assertIn("Warning", s)
        self.assertIn("test message", s)

    def test_error(self):
        f = io.StringIO()
        with contextlib.redirect_stderr(f):
            _common.error("test message")
        s = f.getvalue()
        self.assertIn("Error", s)
        self.assertIn("test message", s)

    def test_debug(self):
        f = io.StringIO()
        with contextlib.redirect_stderr(f):
            _common.debug("test message")
        s = f.getvalue()
        self.assertIn("Debug", s)
        self.assertIn("test message", s)


if __name__ == "__main__":
    unittest.main()
