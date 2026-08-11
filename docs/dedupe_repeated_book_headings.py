#!/usr/bin/env python3
"""Keep each repeated section heading only at its first book occurrence."""

from __future__ import annotations

import argparse
import re
from collections import Counter, defaultdict
from pathlib import Path


NUMBERED_MD = re.compile(r"^\d+\.md$")
UPPER_HEADING = re.compile(r"^[^a-zа-яё]*[A-ZА-ЯЁ][^a-zа-яё]*$")


def numbered_files(folder: Path) -> list[Path]:
    return sorted(
        (path for path in folder.iterdir() if path.is_file() and NUMBERED_MD.match(path.name)),
        key=lambda path: int(path.stem),
    )


def heading_candidate(line: str) -> bool:
    value = line.strip()
    return 3 <= len(value) <= 120 and UPPER_HEADING.fullmatch(value) is not None


def dedupe(folder: Path, apply: bool) -> dict[str, list[str]]:
    files = numbered_files(folder)
    lines_by_file = {path: path.read_text(encoding="utf-8").splitlines() for path in files}
    counts = Counter(
        line.strip()
        for lines in lines_by_file.values()
        for line in lines
        if heading_candidate(line)
    )
    repeated = {heading for heading, count in counts.items() if count > 1}
    seen: set[str] = set()
    removed: dict[str, list[str]] = defaultdict(list)

    for path in files:
        output: list[str] = []
        changed = False
        for line in lines_by_file[path]:
            heading = line.strip()
            if heading in repeated:
                if heading in seen:
                    removed[heading].append(path.name)
                    changed = True
                    continue
                seen.add(heading)
            output.append(line)

        if changed and apply:
            text = "\n".join(output)
            text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
            path.write_text(text, encoding="utf-8", newline="\n")

    return dict(sorted(removed.items()))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folders", nargs="+", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    total = 0
    for folder in args.folders:
        if not folder.is_dir():
            parser.error(f"Not a folder: {folder}")
        removed = dedupe(folder, args.apply)
        count = sum(len(files) for files in removed.values())
        total += count
        print(f"{folder.name}: {count} repeated heading lines in {len(removed)} groups")
        for heading, files in removed.items():
            print(f"  {heading}: {len(files)} removed; first later file {files[0]}")

    print(f"Mode: {'applied' if args.apply else 'dry-run'}; total removals: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
