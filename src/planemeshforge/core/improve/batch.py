"""Headless batch processing: run `improve_quality` (or just a quality
report) over one or more Abaqus decks from the command line, no server or
browser needed. Used by `cli.py`'s `improve`/`quality` subcommands."""

from __future__ import annotations

import csv
import glob
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from ...abaqus_io import read_deck, write_deck
from .. import quality as quality_mod
from ..editor import MeshEditor


@dataclass
class FileReport:
    """One file's before/after (or read-only) quality report."""

    path: str
    output_path: str | None = None
    ok: bool = True
    error: str | None = None
    before: dict = field(default_factory=dict)
    after: dict = field(default_factory=dict)
    flagged_before: int = 0
    flagged_after: int = 0
    duration_s: float = 0.0


def expand_inputs(patterns: list[str]) -> list[str]:
    """Expands glob patterns (and plain paths, kept as-is if nothing matches
    so a typo surfaces as a per-file read error rather than being silently
    dropped) into a sorted, de-duplicated file list."""
    paths: set[str] = set()
    for pattern in patterns:
        matches = glob.glob(pattern)
        paths.update(matches if matches else [pattern])
    return sorted(paths)


def _count_flagged(elements: list[dict], skew_limit: float, aspect_limit: float) -> int:
    return sum(1 for e in elements if e["skewness"] >= skew_limit or (e["aspect_ratio"] or 0) >= aspect_limit)


def quality_report(paths: list[str], skew_limit: float = 0.5, aspect_limit: float = 5.0) -> list[FileReport]:
    """Reads each deck and reports its quality metrics without modifying it."""
    reports = []
    for path in paths:
        start = time.monotonic()
        report = FileReport(path=path)
        try:
            mesh = read_deck(path)
            result = quality_mod.metrics(mesh)
            report.before = result["summary"]
            report.flagged_before = _count_flagged(result["elements"], skew_limit, aspect_limit)
        except Exception as exc:  # noqa: BLE001 - surfaced per-file in the report, not raised
            report.ok = False
            report.error = str(exc)
        report.duration_s = time.monotonic() - start
        reports.append(report)
    return reports


def improve_file(
    path: str,
    *,
    preset: str | None = None,
    steps: list[dict] | None = None,
    limits: dict | None = None,
    outdir: str | None = None,
    suffix: str = "_improved",
) -> FileReport:
    """Runs one `improve_quality` recipe over one deck (via `MeshEditor`, the
    same code path the UI uses) and writes the improved deck alongside the
    input (or into `outdir`). Returns a before/after report; errors are
    captured on the report rather than raised, so a batch of many files
    doesn't abort on the first bad one."""
    start = time.monotonic()
    report = FileReport(path=path)
    try:
        mesh = read_deck(path)
        skew_limit = (limits or {}).get("skewness", 0.5)
        aspect_limit = (limits or {}).get("aspect_ratio", 5.0)

        before_metrics = quality_mod.metrics(mesh)
        report.before = before_metrics["summary"]
        report.flagged_before = _count_flagged(before_metrics["elements"], skew_limit, aspect_limit)

        editor = MeshEditor(mesh)
        op_args: dict = {"limits": limits} if limits else {}
        if steps is not None:
            op_args["steps"] = steps
        else:
            op_args["preset"] = preset or "balanced"
        response = editor.apply("improve_quality", op_args)
        if not response["ok"]:
            raise RuntimeError(response["error"])

        after_metrics = quality_mod.metrics(editor.mesh)
        report.after = after_metrics["summary"]
        report.flagged_after = _count_flagged(after_metrics["elements"], skew_limit, aspect_limit)

        in_path = Path(path)
        out_dir = Path(outdir) if outdir else in_path.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        output_path = out_dir / f"{in_path.stem}{suffix}{in_path.suffix}"
        write_deck(str(output_path), editor.mesh)
        report.output_path = str(output_path)
    except Exception as exc:  # noqa: BLE001 - surfaced per-file in the report, not raised
        report.ok = False
        report.error = str(exc)
    report.duration_s = time.monotonic() - start
    return report


def improve_files(paths: list[str], *, jobs: int = 1, **kwargs) -> list[FileReport]:
    """Runs `improve_file` over every path, optionally with `jobs` files in
    flight at once.

    Uses a thread pool rather than `multiprocessing`: each call only
    touches its own local `Mesh`/`MeshEditor`, so there's no shared state
    to race, and threads sidestep the classic Windows `multiprocessing`
    pitfall where a `console_scripts` entry point re-imports and re-runs
    `main()` in every spawned child.
    """
    if jobs <= 1 or len(paths) <= 1:
        return [improve_file(path, **kwargs) for path in paths]

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(jobs, len(paths))) as pool:
        return list(pool.map(lambda path: improve_file(path, **kwargs), paths))


def write_report(reports: list[FileReport], report_path: str) -> None:
    """Writes `reports` to `report_path` as CSV or JSON, chosen by extension."""
    rows = [_report_row(r) for r in reports]
    if report_path.lower().endswith(".json"):
        with open(report_path, "w") as f:
            json.dump(rows, f, indent=2)
        return

    fieldnames = list(rows[0].keys()) if rows else []
    with open(report_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _report_row(report: FileReport) -> dict:
    row = {
        "path": report.path,
        "ok": report.ok,
        "error": report.error or "",
        "output_path": report.output_path or "",
        "duration_s": round(report.duration_s, 3),
        "flagged_before": report.flagged_before,
        "flagged_after": report.flagged_after,
    }
    for metric in ("skewness", "aspect_ratio"):
        for stat in ("min", "mean", "max"):
            row[f"{metric}_{stat}_before"] = report.before.get(metric, {}).get(stat)
            row[f"{metric}_{stat}_after"] = report.after.get(metric, {}).get(stat)
    return row
