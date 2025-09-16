import unittest
import os
import sys

# Add the project root to the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from utils.abaqus_deck_io import read_abaqus_inp, write_abaqus_inp

class TestAbaqusDeckIO(unittest.TestCase):

    def setUp(self):
        """Set up test files."""
        self.test_read_inp_path = os.path.join(os.path.dirname(__file__), 'test_read.inp')
        self.test_write_inp_path = os.path.join(os.path.dirname(__file__), 'test_write.inp')
        
        # Create a dummy .inp file for reading
        with open(self.test_read_inp_path, 'w') as f:
            f.write("*NODE\n")
            f.write("1, 0.0, 0.0\n")
            f.write("2, 1.0, 0.0\n")
            f.write("3, 1.0, 1.0\n")
            f.write("4, 0.0, 1.0\n")
            f.write("*ELEMENT, TYPE=S2\n")
            f.write("1, 1, 2\n")
            f.write("2, 2, 3\n")
            f.write("3, 3, 4\n")
            f.write("4, 4, 1\n")

    def tearDown(self):
        """Clean up test files."""
        if os.path.exists(self.test_read_inp_path):
            os.remove(self.test_read_inp_path)
        if os.path.exists(self.test_write_inp_path):
            os.remove(self.test_write_inp_path)

    def test_read_abaqus_inp(self):
        """Test reading an Abaqus .inp file."""
        mesh_data = read_abaqus_inp(self.test_read_inp_path)
        
        expected_nodes = [
            {'id': 1, 'x': 0.0, 'y': 0.0},
            {'id': 2, 'x': 1.0, 'y': 0.0},
            {'id': 3, 'x': 1.0, 'y': 1.0},
            {'id': 4, 'x': 0.0, 'y': 1.0}
        ]
        
        expected_elements = [
            {'id': 1, 'node_ids': [1, 2]},
            {'id': 2, 'node_ids': [2, 3]},
            {'id': 3, 'node_ids': [3, 4]},
            {'id': 4, 'node_ids': [4, 1]}
        ]

        self.assertEqual(mesh_data['nodes'], expected_nodes)
        self.assertEqual(mesh_data['elements'], expected_elements)

    def test_write_abaqus_inp(self):
        """Test writing an Abaqus .inp file."""
        mesh_data = {
            "nodes": [
                {'id': 1, 'x': 0.0, 'y': 0.0},
                {'id': 2, 'x': 1.0, 'y': 0.0},
            ],
            "elements": [
                {'id': 1, 'node_ids': [1, 2]}
            ]
        }
        
        write_abaqus_inp(self.test_write_inp_path, mesh_data)
        
        with open(self.test_write_inp_path, 'r') as f:
            content = f.read()
            
        expected_content = "*NODE\n1, 0.000000, 0.000000\n2, 1.000000, 0.000000\n*ELEMENT, TYPE=S2\n1, 1, 2\n"
        self.assertEqual(content.replace('\r\n', '\n'), expected_content.replace('\r\n', '\n'))

if __name__ == '__main__':
    unittest.main()
