import argparse
import os

from . import __version__
from .app import app, socketio, init_storage
from .core.improve.batch import expand_inputs, improve_files, quality_report, write_report
from .core.improve.presets import PRESETS

DEFAULT_DATA_DIR = os.path.join(os.path.expanduser("~"), ".planemeshforge")


def main():
    parser = argparse.ArgumentParser(
        prog="planemeshforge",
        description="PlaneMeshForge: a 2D mesh editor, and a headless CLI for automated quality improvement.",
    )
    parser.add_argument("--version", action="version", version=f"planemeshforge {__version__}")

    # ---- Server (default when no subcommand is given) ----
    parser.add_argument("--host", default="127.0.0.1", help="interface to bind to (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5050, help="port to listen on (default: 5050)")
    parser.add_argument("--debug", action="store_true", help="enable Flask debug mode and auto-reload")
    parser.add_argument(
        "--data-dir",
        default=DEFAULT_DATA_DIR,
        help=f"directory for uploaded meshes and session state (default: {DEFAULT_DATA_DIR})",
    )

    subparsers = parser.add_subparsers(dest="command")

    # ---- `improve`: batch quality improvement ----
    improve_parser = subparsers.add_parser(
        "improve", help="Run an automated quality-improvement recipe over one or more decks, headless."
    )
    improve_parser.add_argument("inputs", nargs="+", help="input .inp/.deck file(s) or glob pattern(s)")
    recipe_group = improve_parser.add_mutually_exclusive_group()
    recipe_group.add_argument("--preset", choices=sorted(PRESETS), help="built-in recipe to run (default: balanced)")
    recipe_group.add_argument("--recipe", help="path to a YAML/JSON file holding a custom list of recipe steps")
    improve_parser.add_argument(
        "-o", "--outdir", help="directory to write improved decks into (default: alongside each input)"
    )
    improve_parser.add_argument(
        "--suffix", default="_improved", help="suffix inserted before the output file's extension (default: _improved)"
    )
    improve_parser.add_argument("--report", help="write a before/after report to this .csv or .json path")
    improve_parser.add_argument(
        "--jobs", type=int, default=1, help="number of files to process concurrently (default: 1)"
    )
    improve_parser.add_argument(
        "--skew-limit", type=float, default=0.5, help="skewness at/above which an element counts as flagged (default: 0.5)"
    )
    improve_parser.add_argument(
        "--aspect-limit",
        type=float,
        default=5.0,
        help="aspect ratio at/above which an element counts as flagged (default: 5.0)",
    )

    # ---- `quality`: read-only report, for CI gating ----
    quality_parser = subparsers.add_parser(
        "quality", help="Report mesh quality for one or more decks without changing them."
    )
    quality_parser.add_argument("inputs", nargs="+", help="input .inp/.deck file(s) or glob pattern(s)")
    quality_parser.add_argument("--report", help="write the report to this .csv or .json path instead of printing a table")
    quality_parser.add_argument("--skew-limit", type=float, default=0.5)
    quality_parser.add_argument("--aspect-limit", type=float, default=5.0)
    quality_parser.add_argument(
        "--fail-under",
        type=float,
        default=None,
        help="exit with status 1 if any file's worst skewness is >= this value (for CI gating)",
    )

    args = parser.parse_args()

    if args.command == "improve":
        return _run_improve(args)
    if args.command == "quality":
        return _run_quality(args)

    init_storage(args.data_dir)
    print(f"PlaneMeshForge running at http://{args.host}:{args.port}")
    socketio.run(app, host=args.host, port=args.port, debug=args.debug, allow_unsafe_werkzeug=True)
    return 0


def _run_improve(args) -> int:
    paths = expand_inputs(args.inputs)
    if not paths:
        print("No input files matched.")
        return 1

    steps = None
    preset = args.preset
    if args.recipe:
        import yaml

        with open(args.recipe) as f:
            steps = yaml.safe_load(f)
    elif not preset:
        preset = "balanced"

    reports = improve_files(
        paths,
        jobs=args.jobs,
        preset=None if steps else preset,
        steps=steps,
        limits={"skewness": args.skew_limit, "aspect_ratio": args.aspect_limit},
        outdir=args.outdir,
        suffix=args.suffix,
    )

    _print_reports(reports)
    if args.report:
        write_report(reports, args.report)
        print(f"Report written to {args.report}")

    return 0 if all(r.ok for r in reports) else 1


def _run_quality(args) -> int:
    paths = expand_inputs(args.inputs)
    if not paths:
        print("No input files matched.")
        return 1

    reports = quality_report(paths, skew_limit=args.skew_limit, aspect_limit=args.aspect_limit)
    _print_reports(reports)
    if args.report:
        write_report(reports, args.report)
        print(f"Report written to {args.report}")

    if not all(r.ok for r in reports):
        return 1
    if args.fail_under is not None:
        worst = max((r.before.get("skewness", {}).get("max") or 0.0) for r in reports)
        if worst >= args.fail_under:
            print(f"FAIL: worst skewness {worst:.3f} >= --fail-under {args.fail_under}")
            return 1
    return 0


def _print_reports(reports) -> None:
    for r in reports:
        if not r.ok:
            print(f"  {r.path}: ERROR - {r.error}")
            continue
        skew_before = r.before.get("skewness", {})
        line = f"  {r.path}: skew max {skew_before.get('max', 0):.3f}"
        if r.after:
            line += f" -> {r.after.get('skewness', {}).get('max', 0):.3f}"
        line += f", flagged {r.flagged_before}"
        if r.after:
            line += f" -> {r.flagged_after}"
        if r.output_path:
            line += f"  [{r.output_path}]"
        print(line)


if __name__ == "__main__":
    main()
