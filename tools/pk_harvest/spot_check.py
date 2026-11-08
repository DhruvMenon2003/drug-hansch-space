#!/usr/bin/env python3
"""Re-fetch N random evidence rows from Europe PMC (bypassing the cache) and confirm each quote is still verbatim.

    uv run --with requests --with openpyxl python tools/pk_harvest/spot_check.py <workbook.xlsx> [n] [seed]
"""

import random
import re
import sys
import xml.etree.ElementTree as ET

import openpyxl
import requests

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
TAG_RE = re.compile(r"<[^>]+>")


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def main() -> int:
    path = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb["PK Evidence"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    hdr = [c.value for c in next(wb["PK Evidence"].iter_rows(min_row=1, max_row=1))]
    col = {h: i for i, h in enumerate(hdr)}
    random.seed(seed)
    sample = random.sample(rows, min(n, len(rows)))
    ok = 0
    s = requests.Session()
    s.headers["User-Agent"] = "drug-hansch-space-pk-harvest spot-check"
    for r in sample:
        pmid, pmcid, quote, loc = r[col["PMID"]], r[col["PMCID"]], r[col["Exact quote"]], r[col["Locator"]]
        text = ""
        if str(loc).startswith("Abstract") and pmid:
            js = s.get(f"{EPMC}/search", params={"query": f"EXT_ID:{pmid} AND SRC:MED", "format": "json", "resultType": "core"}, timeout=60).json()
            res = js.get("resultList", {}).get("result", [])
            text = TAG_RE.sub("", res[0].get("abstractText", "")) if res else ""
        elif pmcid:
            x = s.get(f"{EPMC}/{pmcid}/fullTextXML", timeout=90)
            if x.status_code == 200:
                try:
                    text = "".join(ET.fromstring(x.text).itertext())  # same joining rule as the capture
                except ET.ParseError:
                    text = x.text
        found = norm(quote) in norm(text) or all(norm(part) in norm(text) for part in str(quote).split(" | ") if part.strip())
        ok += found
        print(("OK  " if found else "MISS"), r[col["Drug"]], "|", r[col["Parameter"]], "|", (pmcid or pmid), "|", str(quote)[:90])
    print(f"{ok}/{len(sample)} quotes re-verified against a fresh fetch")
    return 0 if ok == len(sample) else 1


if __name__ == "__main__":
    sys.exit(main())
