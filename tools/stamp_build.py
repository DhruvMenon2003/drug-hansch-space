#!/usr/bin/env python3
"""Stamp one build id into the code and the data, so the page can notice a mix of two deploys (CI only).

GitHub Pages serves every file with max-age=600. A visitor can therefore hold script files from one deploy and revalidate
the data from the next. The page fetches its JSON with cache:'no-cache', and compares the build id in the code
(site/js/version.js, APP_BUILD) with the one in the data (site/data/drugs.json, meta.app_build); if they differ it shows a
"newer version available, reload" banner. A build id of 'dev' (the committed value) never shows it.

    tools/stamp_build.py --build 3f9c2ab71d04   # write the id into version.js and drugs.json
    tools/stamp_build.py                        # id from $GITHUB_SHA (first 12 characters) or $BUILD_ID
    tools/stamp_build.py --dev                  # back to the committed state: APP_BUILD = 'dev', no meta.app_build
    tools/stamp_build.py --check                # exit 1 unless the two stamps agree (both stamped and equal, or both unstamped)

Run it in the deploy workflow after the checks and before the artifact is uploaded; do not commit its output. Only the two
stamps change: drugs.json is edited as text (the file is compact JSON), so nothing else in it moves. Idempotent: the same id
twice gives the same bytes. Python 3 standard library only.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(os.path.dirname(HERE), "site")
ID_OK = re.compile(r"[A-Za-z0-9._-]{1,40}")
VERSION_LINE = re.compile(r"^export const APP_BUILD = '([^'\n]*)';[ \t]*$", re.M)
DATA_STAMP = re.compile(r'"app_build":"([^"\\]*)",?')


def stamp_version_js(text, build):
    """Return version.js text with APP_BUILD = build. Raises ValueError when the line is not there exactly once."""
    if len(VERSION_LINE.findall(text)) != 1:
        raise ValueError("js/version.js must contain exactly one line: export const APP_BUILD = '...';")
    return VERSION_LINE.sub(lambda m: f"export const APP_BUILD = '{build}';", text)


def read_version_js(text):
    m = VERSION_LINE.search(text)
    if not m:
        raise ValueError("js/version.js has no APP_BUILD line")
    return m.group(1)


def stamp_data(text, build):
    """Return drugs.json text with meta.app_build = build (None removes it). Edits the text, then proves the result parses."""
    head = '{"meta":{'
    if not text.startswith(head):
        raise ValueError('drugs.json must start with {"meta":{ (the compact layout tools/build_data.py writes)')
    meta_end = text.index('"drugs":[')
    meta = text[:meta_end]
    meta = DATA_STAMP.sub("", meta)                      # drop any earlier stamp (and its comma)
    if build is not None:
        meta = meta.replace(head, head + f'"app_build":"{build}",', 1)
    out = meta + text[meta_end:]
    obj = json.loads(out)
    if obj["meta"].get("app_build") != build:
        raise ValueError("stamping drugs.json did not give the expected meta.app_build")
    return out


def read_data_stamp(text):
    return json.loads(text)["meta"].get("app_build")


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write_if_changed(path, text):
    try:
        if read_text(path) == text:
            return False
    except OSError:
        pass
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    os.replace(tmp, path)
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build", help="build id (letters, digits, . _ -; at most 40); default: first 12 characters of $GITHUB_SHA, else $BUILD_ID")
    ap.add_argument("--dev", action="store_true", help="restore the committed state: APP_BUILD = 'dev' and no meta.app_build")
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 unless the stamps in version.js and drugs.json agree")
    ap.add_argument("--site", default=SITE, help="the published folder (default: site/ next to tools/)")
    a = ap.parse_args(argv)
    vpath, dpath = os.path.join(a.site, "js", "version.js"), os.path.join(a.site, "data", "drugs.json")
    try:
        vtext, dtext = read_text(vpath), read_text(dpath)
        if a.check:
            code, data = read_version_js(vtext), read_data_stamp(dtext)
            ok = (code == "dev" and data is None) or (code != "dev" and code == data)
            print(f"stamp_build: APP_BUILD={code!r} meta.app_build={data!r}: {'consistent' if ok else 'MISMATCH'}")
            return 0 if ok else 1
        if a.dev:
            build, data_build = "dev", None
        else:
            build = a.build or (os.environ.get("GITHUB_SHA", "")[:12]) or os.environ.get("BUILD_ID", "")
            if not build:
                ap.error("no build id: pass --build, or set GITHUB_SHA / BUILD_ID")
            if not ID_OK.fullmatch(build) or build == "dev":
                ap.error(f"build id {build!r} must match [A-Za-z0-9._-]{{1,40}} and must not be 'dev'")
            data_build = build
        changed = [write_if_changed(vpath, stamp_version_js(vtext, build)), write_if_changed(dpath, stamp_data(dtext, data_build))]
    except (OSError, ValueError, KeyError) as e:
        print(f"stamp_build: {e}", file=sys.stderr)
        return 2
    print(f"stamp_build: build {build!r}: version.js {'written' if changed[0] else 'unchanged'}, drugs.json {'written' if changed[1] else 'unchanged'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
