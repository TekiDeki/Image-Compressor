#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Image Compressor build script - deterministic single-file build.

Reads the sources from src/ and writes one self-contained index.html into the
staging directory. The output is byte-identical for the same inputs: no
timestamps, no random values, no environment data.

    python3 build.py                 # builds ./index.html next to the sources
    python3 build.py --out DIR       # builds DIR/index.html

SPDX-License-Identifier: Apache-2.0
Copyright 2026 Kristian Mario Miskovic (TekiDeki)
"""
import argparse
import hashlib
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
FILES = {
    "template": os.path.join(SRC, "template.html"),
    "styles": os.path.join(SRC, "styles.css"),
    "i18n": os.path.join(SRC, "i18n.js"),
    "app": os.path.join(SRC, "app.js"),
}
MARKERS = {
    "styles": "/*__STYLES__*/",
    "i18n": "/*__I18N__*/",
    "app": "/*__APP__*/",
}
FORBIDDEN = {"\u2014": "em dash (U+2014)", "\u2013": "en dash (U+2013)", "\ufeff": "byte order mark"}
LOCALE_RE = re.compile(r"^\s{2}'?([A-Za-z][A-Za-z0-9\-]*)'?:\s*\{", re.M)
KEY_RE = re.compile(r'^\s{4}([A-Za-z0-9_]+):\s*"((?:[^"\\]|\\.)*)"', re.M)
PLACEHOLDER_RE = re.compile(r"\{([a-z0-9_]+)\}")


def read(path):
    with io.open(path, encoding="utf-8", newline="") as handle:
        return handle.read()


def locale_blocks(source):
    """Splits the I18N object into {locale: body} using brace counting."""
    blocks = {}
    for match in LOCALE_RE.finditer(source):
        name, start = match.group(1), match.start()
        depth, index = 0, start
        while index < len(source):
            if source[index] == "{":
                depth += 1
            elif source[index] == "}":
                depth -= 1
                if depth == 0:
                    break
            index += 1
        if index >= len(source):
            raise SystemExit("i18n: unbalanced braces for locale %s" % name)
        blocks[name] = source[start:index + 1]
    return blocks


def check_locales(source):
    """All locales must share the same keys and the same placeholders per key."""
    blocks = locale_blocks(source)
    if len(blocks) < 4:
        raise SystemExit("i18n: expected at least 4 locales, found %d" % len(blocks))
    parsed = {}
    for name, block in blocks.items():
        entries = {}
        for key, value in KEY_RE.findall(block):
            entries[key] = sorted(set(PLACEHOLDER_RE.findall(value)))
        if not entries:
            raise SystemExit("i18n: locale %s has no keys" % name)
        parsed[name] = entries
    names = list(parsed)
    reference = parsed[names[0]]
    for name in names[1:]:
        missing = sorted(set(reference) - set(parsed[name]))
        extra = sorted(set(parsed[name]) - set(reference))
        if missing or extra:
            raise SystemExit("i18n: locale %s differs (missing=%s extra=%s)" % (name, missing, extra))
        for key, placeholders in reference.items():
            if parsed[name][key] != placeholders:
                raise SystemExit(
                    "i18n: %s/%s placeholders differ: %s vs %s"
                    % (name, key, placeholders, parsed[name][key])
                )
    key_count = len(reference)
    if key_count < 100:
        raise SystemExit("i18n: suspiciously few keys (%d)" % key_count)
    print("i18n ok : %d locales x %d keys" % (len(names), key_count))
    return names


def main():
    parser = argparse.ArgumentParser(description="Build the single-file Image Compressor page.")
    parser.add_argument("--out", default=HERE, help="output directory (default: the script directory)")
    args = parser.parse_args()

    missing = [path for path in FILES.values() if not os.path.isfile(path)]
    if missing:
        raise SystemExit("missing sources: %s" % ", ".join(missing))

    html = read(FILES["template"])
    styles = read(FILES["styles"])
    i18n = read(FILES["i18n"])
    app = read(FILES["app"])

    locales = check_locales(i18n)

    for name, marker in MARKERS.items():
        count = html.count(marker)
        if count != 1:
            raise SystemExit("template: marker %s must appear exactly once, found %d" % (marker, count))

    html = html.replace(MARKERS["styles"], styles.strip("\n"))
    html = html.replace(MARKERS["i18n"], i18n.strip("\n"))
    html = html.replace(MARKERS["app"], app.strip("\n"))

    leftovers = re.findall(r"/\*__[A-Z]+__\*/", html)
    if leftovers:
        raise SystemExit("template: unreplaced markers %s" % leftovers)

    problems = []
    for char, label in FORBIDDEN.items():
        count = html.count(char)
        if count:
            problems.append("%s x%d" % (label, count))
    if problems:
        raise SystemExit("output contains forbidden characters: %s" % ", ".join(problems))

    if not html.endswith("\n"):
        html += "\n"

    directory = os.path.abspath(args.out)
    if not os.path.isdir(directory):
        os.makedirs(directory)
    target = os.path.join(directory, "index.html")
    with io.open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)

    data = html.encode("utf-8")
    print("built   : %s" % target)
    print("locales : %s" % ", ".join(locales))
    print("styles  : %6d B" % len(styles.encode("utf-8")))
    print("i18n    : %6d B" % len(i18n.encode("utf-8")))
    print("app     : %6d B" % len(app.encode("utf-8")))
    print("output  : %6d B" % len(data))
    print("sha256  : %s" % hashlib.sha256(data).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
