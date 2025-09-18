import unittest
import numpy as np
from abaqus_io.element_block import ElementBlock


class TestElementBlock(unittest.TestCase):

    def test_init(self):
        element_type = "CGAX3"
        ids = [1, 2, 3]
        connectivity = [[1, 2, 3], [2, 3, 4], [3, 4, 5]]
        block = ElementBlock(element_type, ids, connectivity)
        self.assertEqual(block.element_type, element_type)
        self.assertTrue(np.array_equal(block.ids, np.asarray(ids)))
        self.assertTrue(np.array_equal(block.connectivity, np.asarray(connectivity)))
        self.assertEqual(block.dim, 2)
        self.assertEqual(block.num_nodes, 3)

    def test_init_with_invalid_input(self):
        with self.assertRaises(ValueError):
            ElementBlock(
                "CGAX3", [1, 2], [[1, 2, 3, 4, 5, 6, 7, 8]]
            )  # Mismatch in connectivity length
        with self.assertRaises(ValueError):
            ElementBlock(
                "C3D8",
                [1, 2, 3],
                [
                    [1, 2, 3, 4, 5, 6, 7, 8],
                    [2, 3, 4, 5, 6, 7, 8, 9],
                    [3, 4, 5, 6, 7, 8, 9, 10],
                ],
            )  # Unsupported element type

    def test_repr(self):
        block = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [2, 3, 4]])
        self.assertEqual(
            repr(block), "<ElementBlock: CGAX3, dim=2, #nodes=3, num_elements=2>"
        )

    def test_len(self):
        block = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [2, 3, 4]])
        self.assertEqual(len(block), 2)

    def test_empty(self):
        block = ElementBlock.empty()
        self.assertEqual(block.element_type, "")
        self.assertEqual(len(block.ids), 0)
        self.assertEqual(len(block.connectivity), 0)
        self.assertEqual(block.dim, 0)
        self.assertEqual(block.num_nodes, 0)

    def test_cat(self):
        block1 = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [2, 3, 4]])
        block2 = ElementBlock("CGAX3", [3, 4], [[3, 4, 5], [4, 5, 6]])
        concatenated_block = ElementBlock.cat([block1, block2])
        self.assertEqual(concatenated_block.element_type, "CGAX3")
        self.assertTrue(np.array_equal(concatenated_block.ids, np.array([1, 2, 3, 4])))
        self.assertEqual(len(concatenated_block), 4)
        self.assertEqual(concatenated_block.dim, 2)

    def test_cat_with_different_element_types(self):
        block1 = ElementBlock("CGAX3", [1, 2], [[1, 2, 3], [2, 3, 4]])
        block2 = ElementBlock("SFMGAX1", [3, 4], [[3, 4], [4, 5]])
        with self.assertRaises(ValueError):
            ElementBlock.cat([block1, block2])

    def test_cat_with_empty_list(self):
        block = ElementBlock.cat([])
        self.assertTrue(isinstance(block, ElementBlock))
        self.assertEqual(len(block), 0)
        self.assertEqual(block.dim, 0)
        self.assertEqual(block.num_nodes, 0)


if __name__ == "__main__":
    unittest.main()
