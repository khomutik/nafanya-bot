#!/usr/bin/env python3
"""Replace selected R2 library collections with numbered Markdown files."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


COLLECTION_FOLDERS = {
    "twelve_twelve": "02 12 шагов и 12 традиций",
    "living_sober": "03 Жить трезвыми",
}


def load_numbered_entries(vault: Path, folder_name: str) -> dict[str, dict[str, str]]:
    folder = vault / folder_name
    files = sorted(folder.glob("*.md"), key=lambda path: int(path.stem))
    entries: dict[str, dict[str, str]] = {}
    for path in files:
        key = str(int(path.stem))
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            raise ValueError(f"Empty file: {path}")
        entries[key] = {
            "text": text,
            "sourcePath": f"{folder_name}/{path.name}",
        }
    expected = [str(number) for number in range(1, len(entries) + 1)]
    if list(entries) != expected:
        raise ValueError(f"Numbering gap in {folder}")
    return entries


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("current_json", type=Path)
    parser.add_argument("vault", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()

    library = json.loads(args.current_json.read_text(encoding="utf-8"))
    collections = library.get("collections")
    if not isinstance(collections, dict):
        raise ValueError("Library has no collections object")

    for collection_id, folder_name in COLLECTION_FOLDERS.items():
        collection = collections.get(collection_id)
        if not isinstance(collection, dict):
            raise ValueError(f"Missing collection: {collection_id}")
        collection["entries"] = load_numbered_entries(args.vault, folder_name)

    timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    library["version"] = f"dedup-headings-{timestamp}"
    library["publishedAt"] = timestamp
    args.output_json.write_text(
        json.dumps(library, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
        newline="\n",
    )
    print(f"Wrote {args.output_json}")
    for collection_id in COLLECTION_FOLDERS:
        print(f"{collection_id}: {len(collections[collection_id]['entries'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
