import numpy as np
from .mesh_io import Mesh


func_node_line = lambda ids: ",".join(f"{id:>9}" for id in ids)


def write_deck(filename, mesh: Mesh, comment_line: str = "") -> None:
    """Writes an Abaqus inp file, focusing on geometry portion."""

    # max number of values per line
    nnl: int = 8

    with open(filename, "wt") as f:
        if comment_line:
            f.write(f"{comment_line}\n")

        f.write("**" + "-" * 78 + "\n")
        f.write("**  NODE DEFINITION\n")

        f.write("*NODE\n")
        for k, xyz_id in enumerate(zip(mesh.points, mesh.point_ids)):
            xyz, id = xyz_id[0], xyz_id[1]
            str_coords = ", ".join(f"{entry:10.6f}" for entry in xyz)
            output = f"{id:9}, {str_coords}\n"
            f.write(output)

        f.write("**--end--node--definition\n")
        f.flush()

        f.write("**" + "-" * 78 + "\n")
        f.write("**  NODE SET DEFINITION\n")

        for name, ids in mesh.node_sets.items():
            if len(ids) > 0:
                f.write(f"*NSET, NSET={name}\n")
                # Ensure v is a 1D array for iteration
                output = ",\n".join(
                    func_node_line(ids[i : i + nnl]) for i in range(0, len(ids), nnl)
                )
                f.write(output + ",\n")
                f.write("**" + "-" * 78 + "\n")

        f.write("**--end--node--set--definition\n")
        f.flush()

        f.write("**" + "-" * 78 + "\n")
        f.write("**  ELEMENT DEFINITION\n")

        eid = 0
        for cell_block in mesh.cells:
            if len(cell_block.ids) > 0:
                cell_type = cell_block.element_type
                f.write(f"*ELEMENT, TYPE={cell_type}\n")
                for eid, row in zip(cell_block.ids, cell_block.connectivity):
                    f.write(" " + str(eid) + "," + func_node_line(row) + ",\n")
                f.write("**" + "-" * 78 + "\n")

        f.write("**--end--element--definition\n")
        f.flush()

        f.write("**" + "-" * 78 + "\n")
        f.write("**  ELEMENT SET DEFINITION\n")

        for name, ids in mesh.elem_sets.items():
            if len(ids) > 0:
                f.write(f"*ELSET, ELSET={name}\n")
                output = ",\n".join(
                    func_node_line(ids[i : i + nnl]) for i in range(0, len(ids), nnl)
                )
                f.write(output + ",\n")
                f.write("**" + "-" * 78 + "\n")

        f.write("**--end--element--set--definition\n")
        f.flush()

        f.write("**" + "-" * 78 + "\n")
        f.write("**  SURFACE DEFINITIONS\n")

        for name, ids in mesh.surface_sets.items():
            if len(ids) > 0:
                f.write(f"*SURFACE, NAME={name}, TYPE=ELEMENT\n")
                output = "\n".join(
                    func_node_line(ids[i : i + 2]) for i in range(0, len(ids), 2)
                )
                f.write(" " + output + "\n")
                f.write("**" + "-" * 78 + "\n")

        f.flush()
