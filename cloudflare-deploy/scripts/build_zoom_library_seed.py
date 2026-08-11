#!/usr/bin/env python3
"""Build the initial private Zoom library JSON from a numbered Markdown ZIP."""

from __future__ import annotations

import argparse
import json
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


NUMBERED_MARKDOWN = re.compile(r"^(\d{1,4})\.md$", re.IGNORECASE)


def normalized_markdown(raw: bytes) -> str:
    text = raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    if text.startswith("---\n"):
        text = re.sub(r"^---\s*\n[\s\S]*?\n---\s*(?:\n|$)", "", text, count=1)
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def build_library(zip_path: Path) -> dict:
    entries: dict[int, dict[str, str]] = {}
    with zipfile.ZipFile(zip_path) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            path = PurePosixPath(item.filename)
            match = NUMBERED_MARKDOWN.fullmatch(path.name)
            if not match:
                continue
            number = int(match.group(1))
            if number in entries:
                raise ValueError(f"Duplicate excerpt number: {number}")
            text = normalized_markdown(archive.read(item))
            if not text:
                raise ValueError(f"Empty excerpt: {item.filename}")
            entries[number] = {"text": text, "sourcePath": item.filename}
    if not entries:
        raise ValueError("No numbered Markdown files found")
    expected = set(range(1, max(entries) + 1))
    missing = sorted(expected - set(entries))
    if missing:
        raise ValueError(f"Missing excerpt numbers: {missing[:20]}")
    return {
        "schemaVersion": 1,
        "version": f"seed-{uuid.uuid4()}",
        "publishedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "collections": {
            "big_book": {
                "label": "Большая книга",
                "kind": "numbered",
                "entries": {str(number): entries[number] for number in sorted(entries)},
            }
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("zip_path", type=Path)
    parser.add_argument("output_path", type=Path)
    args = parser.parse_args()
    library = build_library(args.zip_path)
    args.output_path.write_text(json.dumps(library, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    excerpts = library["collections"]["big_book"]["entries"]
    longest = max(len(item["text"]) for item in excerpts.values())
    print(f"Built {len(excerpts)} excerpts; longest source text: {longest} characters; output: {args.output_path}")


if __name__ == "__main__":
    main()
