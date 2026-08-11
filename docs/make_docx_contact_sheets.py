from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def page_number(path: Path) -> int:
    match = re.search(r"(\d+)$", path.stem)
    return int(match.group(1)) if match else 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pages_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=4)
    args = parser.parse_args()

    pages = sorted(args.pages_dir.glob("page-*.png"), key=page_number)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    per_sheet = args.columns * args.rows
    tile_width, tile_height, label_height, gap = 408, 528, 24, 12
    sheet_width = gap + args.columns * (tile_width + gap)
    sheet_height = gap + args.rows * (tile_height + label_height + gap)
    font = ImageFont.load_default()

    for sheet_index in range(0, len(pages), per_sheet):
        batch = pages[sheet_index:sheet_index + per_sheet]
        canvas = Image.new("RGB", (sheet_width, sheet_height), "#d9dde5")
        draw = ImageDraw.Draw(canvas)
        for index, path in enumerate(batch):
            row, column = divmod(index, args.columns)
            x = gap + column * (tile_width + gap)
            y = gap + row * (tile_height + label_height + gap)
            with Image.open(path) as source:
                page = source.convert("RGB")
                page.thumbnail((tile_width, tile_height), Image.Resampling.LANCZOS)
                px = x + (tile_width - page.width) // 2
                py = y + (tile_height - page.height) // 2
                canvas.paste(page, (px, py))
            label = f"page {page_number(path)}"
            draw.rectangle((x, y + tile_height, x + tile_width, y + tile_height + label_height), fill="white")
            draw.text((x + 6, y + tile_height + 6), label, fill="black", font=font)
        first, last = page_number(batch[0]), page_number(batch[-1])
        canvas.save(args.output_dir / f"sheet-{first:03d}-{last:03d}.jpg", quality=88, optimize=True)


if __name__ == "__main__":
    main()
