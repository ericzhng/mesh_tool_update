"""
This module contains common utility functions used across the abaqus_io package.
"""

from __future__ import annotations

from rich.console import Console
import numpy as np
import yaml
import os

# ==============================================================================
# Data Manipulation Functions
# ==============================================================================


def unflatten_cell_data(flat_cell_data, block_counts):
    """
    Splits a dictionary of flat 1D data arrays into a dictionary of lists of
    numpy arrays.

    This function is useful for partitioning a flat data array into multiple
    arrays, each corresponding to a block of cells of the same type. This is
    often required when reading cell data from file formats where data for
    different element types is stored in a single contiguous array.

    Args:
        flat_cell_data (dict[str, np.ndarray]): A dictionary of flat cell data
            arrays. The keys are the data names and the values are the 1D
            numpy arrays.
        block_counts (list[int]): A list of integers representing the number of
            cells in each block. The sum of the counts must be equal to the
            length of the data arrays in `flat_cell_data`.

    Returns:
        dict[str, list[np.ndarray]]: A dictionary of structured cell data. The
        keys are the data names and the values are lists of numpy arrays, where
        each array corresponds to a cell block.
    """
    # Check that the dimensions of the data match the block counts
    total_cells = sum(block_counts)
    for data_name, flat_data_array in flat_cell_data.items():
        if len(flat_data_array) != total_cells:
            raise ValueError(
                f"The number of cells in the data array '{data_name}' "
                f"({len(flat_data_array)}) does not match the total number of "
                f"cells in the blocks ({total_cells})."
            )

    # Get the indices where to split the arrays
    split_indices = np.cumsum(block_counts, dtype=np.int32)[:-1]
    return {
        data_name: np.split(flat_data_array, split_indices)
        for data_name, flat_data_array in flat_cell_data.items()
    }


def flatten_cell_data(structured_cell_data):
    """
    Concatenates a dictionary of lists of numpy arrays into a dictionary of
    flat 1D data arrays.

    This function is the inverse of `unflatten_cell_data`. It is useful when
    writing cell data to file formats that require the data for different
    element types to be stored in a single contiguous array.

    Args:
        structured_cell_data (dict[str, list[np.ndarray]]): A dictionary of
            structured cell data. The keys are the data names and the values
            are lists of numpy arrays, where each array corresponds to a cell
            block.

    Returns:
        dict[str, np.ndarray]: A dictionary of flat cell data arrays. The keys
        are the data names and the values are the 1D numpy arrays.
    """
    return {
        data_name: np.concatenate(data_arrays)
        for data_name, data_arrays in structured_cell_data.items()
    }


# ==============================================================================
# Logging Functions
# ==============================================================================


def debug(message: str, highlight: bool = True) -> None:
    """
    Prints a debug message to the console.

    Args:
        message: The message to print.
        highlight: Whether to highlight the message.
    """
    Console(stderr=True).print(
        f"[blue][bold]Debug:[/bold] {message}[/blue]", highlight=highlight
    )


def info(message: str, highlight: bool = True) -> None:
    """
    Prints an informational message to the console.

    Args:
        message: The message to print.
        highlight: Whether to highlight the message.
    """
    Console(stderr=True).print(f"[bold]Info:[/bold] {message}", highlight=highlight)


def warning(message: str, highlight: bool = True) -> None:
    """
    Prints a warning message to the console.

    Args:
        message: The message to print.
        highlight: Whether to highlight the message.
    """
    Console(stderr=True).print(
        f"[yellow][bold]Warning:[/bold] {message}[/yellow]", highlight=highlight
    )


def error(message: str, highlight: bool = True) -> None:
    """
    Prints an error message to the console.

    Args:
        message: The message to print.
        highlight: Whether to highlight the message.
    """
    Console(stderr=True).print(
        f"[red][bold]Error:[/bold] {message}[/red]", highlight=highlight
    )


# ==============================================================================
# String Manipulation Functions
# ==============================================================================


def is_substring_in_any(substring: str, string_list: list[str]) -> bool:
    """
    Checks if a substring is present in any of the strings in a list.

    Args:
        substring: The substring to search for.
        string_list: A list of strings to search in.

    Returns:
        True if the substring is found, False otherwise.
    """
    return any(substring in s for s in string_list)


def join_strings_with_separator(string_list: list[str]) -> tuple[str, str]:
    """
    Joins a list of strings with a character that is not present in any of the
    strings. This allows the joined string to be split again uniquely.

    Args:
        string_list: A list of strings to join.

    Returns:
        A tuple containing the joined string and the character used to join.
    """
    possible_separators = ["-", "_", "#", "+", "/"]
    for separator in possible_separators:
        if not is_substring_in_any(separator, string_list):
            return separator.join(string_list), separator
    raise ValueError("Could not find a suitable character to join the strings.")


def split_string_by_separator(joined_string: str, separator: str) -> list[str]:
    """
    Splits a string that was joined by `join_strings_with_separator`.

    Args:
        joined_string: The string to split.
        separator: The character used to join the string.

    Returns:
        A list of the original strings.
    """
    return joined_string.split(separator)


def replace_spaces_with_char(input_string: str) -> tuple[str, str]:
    """
    Replaces all spaces in a string with a character that is not present in the
    string.

    Args:
        input_string: The string to replace spaces in.

    Returns:
        A tuple containing the modified string and the character used for
        replacement.
    """
    possible_replacement_chars = ["_", "-", "+", "X", "/", "#"]
    for char in possible_replacement_chars:
        if char not in input_string:
            return input_string.replace(" ", char), char
    raise ValueError("Could not find a suitable character to replace spaces.")


# ==============================================================================
# YAML parsing
# ==============================================================================


def read_config():
    """
    Reads the config.yaml file and returns the supported element types and dims.
    """
    config_path = os.path.join(os.path.dirname(__file__), "..", "etc", "config.yaml")
    with open(config_path, "r") as f:
        config = yaml.safe_load(f)
    return config
