#!/usr/bin/env python3
"""Insert the Russian dictionary into the built client bundle and register it.

Run from the package root: python3 scripts/apply-ru.py
The build artifact client/client.js is patched in place; tmp-ru.json is the
translated dictionary produced from tmp-en.json.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "client" / "client.js"
RU = ROOT / "tmp-ru.json"
EN = ROOT / "tmp-en.json"


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    source = BUNDLE.read_text(encoding="utf-8")
    en = json.loads(EN.read_text(encoding="utf-8"))
    ru = json.loads(RU.read_text(encoding="utf-8"))

    if list(en) != list(ru):
        raise fail("ru keys differ from en keys in order or name")

    for key, value in ru.items():
        expected = sorted(re.findall(r"\{\w+\}", en[key]))
        actual = sorted(re.findall(r"\{\w+\}", value))
        if expected != actual:
            fail(f"placeholder mismatch in {key!r}: {expected} != {actual}")
        if re.search(r"[\u4e00-\u9fff]", value):
            fail(f"CJK characters left in {key!r}")


    lines = ['\t\tconst ru = {']
    for key, value in ru.items():
        rendered = key if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", key) else json.dumps(key, ensure_ascii=False)
        lines.append(f"\t\t\t{rendered}: {json.dumps(value, ensure_ascii=False)},")
    lines.append("\t\t};")
    block = "\n".join(lines) + "\n"

    start = source.index("\t\tconst en = {")
    end = source.index("\n\t\t};\n", start) + len("\n\t\t};\n")
    existing = source.find("\t\tconst ru = {", end)
    if existing == -1:
        source = source[:end] + block + source[end:]
    else:
        existing_end = source.index("\n\t\t};\n", existing) + len("\n\t\t};\n")
        source = source[:end] + block + source[existing_end:]

    old_register = """\t\t\tctx.effect(() => ctx.locale.register(NS, {
\t\t\t\tzh,
\t\t\t\ten
\t\t\t}), `${NS}: dictionaries`);"""
    new_register = """\t\t\tctx.effect(() => ctx.locale.register(NS, {
\t\t\t\tzh,
\t\t\t\ten,
\t\t\t\tru
\t\t\t}), `${NS}: dictionaries`);"""
    if source.count(new_register) == 1:
        pass
    elif source.count(old_register) == 1:
        source = source.replace(old_register, new_register)
    else:
        fail("locale.register block not found exactly once")

    BUNDLE.write_text(source, encoding="utf-8")
    print(f"inserted {len(ru)} Russian entries into {BUNDLE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
