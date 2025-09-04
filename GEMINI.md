# Mesh Update Tool

## Project Overview

This project is a web tool for mesh manipulation based on Python. The purpose is to create an app that can visualize a structural mesh. Here a mesh refers to a 2D geometric mesh. The node coordinates and element connectivity are given to describe the mesh.

For the interface, we have two main groups, one is a mesh view panel, and ther other area contains some button controls that can be used to change mesh. There should be a title and summary section, that can show the mesh info in real time.

The mesh view panel is interactive to allow users to pan, zoom and rotate the mesh view. The main purpose is to allow users to move certain nodes around, adding or removing nodes, adding and removing lines connecting two nodes. The mesh information such as mesh connectivity and coordinates can be automatically updated when exporting the mesh.

## Technology Stack

- **Frontend:** React
- **Backend:** flask, python

## Project Structure

- `src/components/`: Reusable React components
- `src/pages/`: Next.js page components
- `src/lib/`: Utility functions and helper modules

## Coding Conventions

- Use camelCase for variable and function names.
- Interface names should be prefixed with 'I'.
- All new functions must include JSDoc comments.
- Prefer functional components and React Hooks.

## General Instructions

- Please follow the PEP 8 – Style Guide for Python Code
- Ensure all functions and classes have standard docstrings and comments.
- Separate html, css and js files
- Use 4 spaces for indentation.

## Features

- Use modern UI components in a pretty way
- Interactive web interface for mesh editing
- View real-time mesh summary information as changes are made
- Able to move mesh nodes
- Able to add or remove nodes
- Able to draw or delete connections between nodes
- Able to export the updated connectivity matrix
