import argparse
import os

from . import __version__
from .app import app, socketio, init_storage

DEFAULT_DATA_DIR = os.path.join(os.path.expanduser("~"), ".planemeshforge")


def main():
    parser = argparse.ArgumentParser(
        prog="planemeshforge", description="Launch the PlaneMeshForge 2D mesh editor."
    )
    parser.add_argument("--host", default="127.0.0.1", help="interface to bind to (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5050, help="port to listen on (default: 5050)")
    parser.add_argument("--debug", action="store_true", help="enable Flask debug mode and auto-reload")
    parser.add_argument(
        "--data-dir",
        default=DEFAULT_DATA_DIR,
        help=f"directory for uploaded meshes and session state (default: {DEFAULT_DATA_DIR})",
    )
    parser.add_argument("--version", action="version", version=f"planemeshforge {__version__}")
    args = parser.parse_args()

    init_storage(args.data_dir)

    print(f"PlaneMeshForge running at http://{args.host}:{args.port}")
    socketio.run(app, host=args.host, port=args.port, debug=args.debug, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
