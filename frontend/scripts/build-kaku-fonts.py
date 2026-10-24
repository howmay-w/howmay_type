"""把 howmay sitever 切成 unicode-range woff2，假名改用 Zen Kaku Gothic New 原版。

網站只用 400／500／700。漢字、符號、拉丁與補字來自 sitever；
平假名、片假名、半形假名、長音「ー」、濁音與重複記號來自原版。

  python3 frontend/scripts/build-kaku-fonts.py \
    --sitever ~/Desktop/howmay_verkaku \
    --official /tmp/zenkaku-official
"""

from __future__ import annotations

import argparse
import shutil
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "src" / "fonts" / "kaku"
CHUNK_SIZE = 100

WEIGHTS = (
    (400, "Regular"),
    (500, "Medium"),
    (700, "Bold"),
)

OFFICIAL_URLS = {
    "ZenKakuGothicNew-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/zenkakugothicnew/ZenKakuGothicNew-Regular.ttf",
    "ZenKakuGothicNew-Medium.ttf": "https://github.com/google/fonts/raw/main/ofl/zenkakugothicnew/ZenKakuGothicNew-Medium.ttf",
    "ZenKakuGothicNew-Bold.ttf": "https://github.com/google/fonts/raw/main/ofl/zenkakugothicnew/ZenKakuGothicNew-Bold.ttf",
    "OFL.txt": "https://github.com/google/fonts/raw/main/ofl/zenkakugothicnew/OFL.txt",
}


def is_kana(codepoint: int) -> bool:
    if 0x3041 <= codepoint <= 0x3096 or 0x3099 <= codepoint <= 0x309F:
        return True
    if 0x30A1 <= codepoint <= 0x30FA or codepoint == 0x30FC or 0x30FD <= codepoint <= 0x30FF:
        return True
    if 0x31F0 <= codepoint <= 0x31FF:
        return True
    if 0xFF66 <= codepoint <= 0xFF9F:
        return True
    if 0x1B000 <= codepoint <= 0x1B122 or 0x1B150 <= codepoint <= 0x1B152:
        return True
    return False


def cmap_of(path: Path) -> dict[int, str]:
    font = TTFont(path)
    try:
        return dict(font.getBestCmap() or {})
    finally:
        font.close()


def compress_ranges(codepoints: list[int]) -> str:
    parts: list[str] = []
    start = previous = codepoints[0]
    for codepoint in codepoints[1:]:
        if codepoint == previous + 1:
            previous = codepoint
            continue
        parts.append(format_range(start, previous))
        start = previous = codepoint
    parts.append(format_range(start, previous))
    return ", ".join(parts)


def format_range(start: int, end: int) -> str:
    if start == end:
        return f"U+{start:04X}"
    return f"U+{start:04X}-{end:04X}"


def chunks(codepoints: list[int], size: int) -> list[list[int]]:
    ordered = sorted(codepoints)
    return [ordered[index : index + size] for index in range(0, len(ordered), size)]


def subset_font(src: str, unicodes: list[int], dest: str, clear_use_typo: bool) -> None:
    font = TTFont(src)
    options = Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.hinting = True
    options.notdef_glyph = True
    options.notdef_outline = True
    options.ignore_missing_unicodes = True
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    if clear_use_typo:
        font["OS/2"].fsSelection &= ~0x80
    font.flavor = "woff2"
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    font.save(dest)
    font.close()


def ensure_official(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    missing = [name for name in OFFICIAL_URLS if not (directory / name).exists()]
    if not missing:
        return
    import urllib.request

    for name in missing:
        target = directory / name
        print(f"download {name}")
        urllib.request.urlretrieve(OFFICIAL_URLS[name], target)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sitever", type=Path, default=Path.home() / "Desktop" / "howmay_verkaku")
    parser.add_argument("--official", type=Path, default=ROOT / "scripts" / ".cache" / "zen-kaku")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--chunk-size", type=int, default=CHUNK_SIZE)
    args = parser.parse_args()

    ensure_official(args.official)
    files_dir = args.out / "files"
    if files_dir.exists():
        shutil.rmtree(files_dir)
    files_dir.mkdir(parents=True)
    shutil.copyfile(args.official / "OFL.txt", args.out / "OFL.txt")

    site_cmaps = {}
    official_cmaps = {}
    for weight, style in WEIGHTS:
        site_path = args.sitever / f"ZenKakuGothic_howmay_sitever-{style}.otf"
        official_path = args.official / f"ZenKakuGothicNew-{style}.ttf"
        if not site_path.exists():
            raise SystemExit(f"找不到 {site_path}")
        site_cmaps[weight] = cmap_of(site_path)
        official_cmaps[weight] = cmap_of(official_path)

    reference = site_cmaps[400]
    shape_codepoints = sorted(codepoint for codepoint in reference if not is_kana(codepoint))
    kana_codepoints = sorted(codepoint for codepoint in official_cmaps[400] if is_kana(codepoint))
    for weight, _style in WEIGHTS[1:]:
        site_shape = {codepoint for codepoint in site_cmaps[weight] if not is_kana(codepoint)}
        official_kana = {codepoint for codepoint in official_cmaps[weight] if is_kana(codepoint)}
        if site_shape != set(shape_codepoints) or official_kana != set(kana_codepoints):
            raise SystemExit(f"{weight} 的字元和 Regular 不一致")

    site_only_kana = sorted(codepoint for codepoint in reference if is_kana(codepoint) and codepoint not in kana_codepoints)
    if site_only_kana:
        raise SystemExit("sitever 有原版沒有的假名：" + "".join(chr(codepoint) for codepoint in site_only_kana))

    shape_chunks = chunks(shape_codepoints, args.chunk_size)
    jobs = []
    rules: list[tuple[int, str, str]] = []
    for weight, style in WEIGHTS:
        site_path = args.sitever / f"ZenKakuGothic_howmay_sitever-{style}.otf"
        official_path = args.official / f"ZenKakuGothicNew-{style}.ttf"
        for index, group in enumerate(shape_chunks, start=1):
            filename = f"kaku-{weight}-{index:03d}.woff2"
            dest = files_dir / filename
            jobs.append((str(site_path), group, str(dest), True))
            rules.append((weight, filename, compress_ranges(group)))
        kana_name = f"kana-{weight}.woff2"
        jobs.append((str(official_path), kana_codepoints, str(files_dir / kana_name), False))
        rules.append((weight, kana_name, compress_ranges(kana_codepoints)))

    workers = min(8, len(jobs))
    print(f"subset {len(jobs)} files with {workers} workers")
    with ProcessPoolExecutor(max_workers=workers) as pool:
        list(pool.map(subset_font, *zip(*jobs), chunksize=1))

    css_path = args.out / "kaku.css"
    lines = [
        "/* 漢字、符號、拉丁與補字來自 howmay sitever，依 unicode-range 切檔。",
        "   假名（含長音「ー」、濁音與重複記號）來自 Zen Kaku Gothic New 原版。",
        "   重新產生：python3 frontend/scripts/build-kaku-fonts.py */",
        "",
    ]
    for weight, filename, unicode_range in rules:
        lines.extend(
            [
                "@font-face {",
                '  font-family: "Zen Kaku Gothic New";',
                "  font-style: normal;",
                "  font-display: swap;",
                f"  font-weight: {weight};",
                f'  src: url("./files/{filename}?no-inline") format("woff2");',
                f"  unicode-range: {unicode_range};",
                "}",
                "",
            ]
        )
    css_path.write_text("\n".join(lines), encoding="utf-8")

    covered: dict[int, list[str]] = {}
    for weight, filename, unicode_range in rules:
        if weight != 400:
            continue
        for codepoint in parse_range(unicode_range):
            covered.setdefault(codepoint, []).append(filename)
    overlaps = {codepoint: names for codepoint, names in covered.items() if len(names) > 1}
    if overlaps:
        sample = next(iter(overlaps))
        raise SystemExit(f"unicode-range 重疊，例如 U+{sample:04X} -> {overlaps[sample]}")

    total = 0
    largest = (0, "")
    per_weight = {weight: 0 for weight, _style in WEIGHTS}
    for path in files_dir.glob("*.woff2"):
        size = path.stat().st_size
        total += size
        weight = int(path.stem.split("-")[1])
        per_weight[weight] += size
        if size > largest[0]:
            largest = (size, path.name)
        font = TTFont(path)
        try:
            if font["OS/2"].fsSelection & 0x80:
                raise SystemExit(f"{path.name} 仍開著 Use Typo Metrics")
        finally:
            font.close()

    ni = 0x4F60
    a_kana = 0x3042
    print(f"shape glyphs {len(shape_codepoints)} in {len(shape_chunks)} chunks/weight")
    print(f"kana glyphs {len(kana_codepoints)}")
    print(f"你 -> {covered.get(ni)}")
    print(f"あ -> {covered.get(a_kana)}")
    print(f"ー -> {covered.get(0x30FC)}")
    for weight, size in per_weight.items():
        print(f"weight {weight}: {size / 1024:.0f} KB")
    print(f"total {total / 1024:.0f} KB, largest {largest[1]} {largest[0] / 1024:.1f} KB")
    print(f"wrote {css_path}")


def parse_range(text: str) -> list[int]:
    codepoints: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if "-" in part[2:]:
            start, end = part.split("-")
            codepoints.extend(range(int(start[2:], 16), int(end, 16) + 1))
        else:
            codepoints.append(int(part[2:], 16))
    return codepoints


if __name__ == "__main__":
    main()
