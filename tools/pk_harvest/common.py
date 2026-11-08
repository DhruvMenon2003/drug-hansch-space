"""Shared helpers for the PK source harvest: cached, rate-limited HTTP and paths.

Only public, lawful endpoints are used (Europe PMC, Crossref, Unpaywall, PubChem, ChEMBL, UniChem).
Every response is cached under tools/pk_harvest/cache/ (gitignored) so reruns are reproducible and polite.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
CACHE = HERE / "cache"
RESULTS = CACHE / "results"
UA = "drug-hansch-space-pk-harvest/0.1 (https://github.com/DhruvMenon2003/drug-hansch-space; mailto:mynameisdhruvmenon@gmail.com)"
BODY_WEIGHT_KG = 70.0

_tls = threading.local()
_lock = threading.Lock()
_last_call: dict[str, float] = {}


def _sess() -> requests.Session:
    s = getattr(_tls, "session", None)
    if s is None:
        s = requests.Session()
        s.headers["User-Agent"] = UA
        _tls.session = s
    return s
MIN_INTERVAL = {"www.ebi.ac.uk": 0.15, "api.crossref.org": 1.0, "api.unpaywall.org": 0.5,
                "pubchem.ncbi.nlm.nih.gov": 0.2, "api.platform.opentargets.org": 0.2, "default": 0.5}


def _host(url: str) -> str:
    return re.sub(r"^https?://([^/]+).*$", r"\1", url)


def _throttle(url: str) -> None:
    host = _host(url)
    gap = MIN_INTERVAL.get(host, MIN_INTERVAL["default"])
    with _lock:  # hand out slots `gap` seconds apart per host; each caller sleeps until its own slot
        now = time.time()
        slot = max(now, _last_call.get(host, 0.0) + gap)
        _last_call[host] = slot
    wait = slot - now
    if wait > 0:
        time.sleep(wait)


def cache_path(kind: str, key: str, suffix: str = ".json") -> Path:
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
    d = CACHE / kind
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{h}{suffix}"


def get(url: str, params: dict | None = None, kind: str = "http", timeout: int = 60,
        retries: int = 2, accept: str | None = None, allow_404: bool = True) -> dict:
    """GET with disk cache. Returns {"status": int, "text": str, "url": str, "fetched": iso}.

    Non-200 answers are cached too (status kept), so a dead endpoint is not hammered on reruns."""
    req = requests.Request("GET", url, params=params).prepare()
    key = req.url
    p = cache_path(kind, key)
    if p.exists():
        return json.loads(p.read_text("utf-8"))
    headers = {"Accept": accept} if accept else {}
    err = None
    for attempt in range(retries):
        _throttle(url)
        try:
            r = _sess().get(key, headers=headers, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                err = f"HTTP {r.status_code}"
                continue
            out = {"status": r.status_code, "text": r.text if r.status_code == 200 else r.text[:500], "url": key,
                   "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            if r.status_code != 429:
                p.write_text(json.dumps(out), "utf-8")
            return out
        except requests.RequestException as e:  # network hiccup: retry
            err = str(e)
            time.sleep(2 * (attempt + 1))
    return {"status": 0, "text": "", "url": key, "error": err or "unknown",
            "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def get_json(url: str, params: dict | None = None, kind: str = "http", **kw) -> dict | list | None:
    r = get(url, params, kind=kind, accept="application/json", **kw)
    if r["status"] != 200:
        return None
    try:
        return json.loads(r["text"])
    except json.JSONDecodeError:
        return None


def post_json(url: str, payload: dict, kind: str = "post", timeout: int = 60, retries: int = 2) -> dict | None:
    """POST JSON with disk cache keyed on url + body (used for the Open Targets GraphQL endpoint)."""
    body = json.dumps(payload, sort_keys=True)
    p = cache_path(kind, url + "\n" + body)
    if p.exists():
        cached = json.loads(p.read_text("utf-8"))
        return cached.get("json")
    for attempt in range(retries):
        _throttle(url)
        try:
            r = _sess().post(url, data=body, headers={"Content-Type": "application/json", "Accept": "application/json"},
                             timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            js = None
            if r.status_code == 200:
                try:
                    js = r.json()
                except ValueError:
                    js = None
            if r.status_code in (200, 400, 404):
                p.write_text(json.dumps({"status": r.status_code, "json": js,
                                         "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}), "utf-8")
            return js
        except requests.RequestException:
            time.sleep(2 * (attempt + 1))
    return None


def read_drug_names(xlsx: Path) -> list[str]:
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, read_only=True)
    ws = wb["Drug Names"]
    names = []
    for (v,) in ws.iter_rows(min_row=2, max_col=1, values_only=True):
        if v is not None and str(v).strip():
            names.append(str(v).strip())
    return names


def read_existing(xlsx: Path) -> dict[int, dict[str, float]]:
    """Existing table values per Drug Names index (1-based): Vss (AH), CL (AI), fu (AM) when numeric and > 0."""
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, read_only=True)
    ws = wb["Drug Leaderboard"]
    out: dict[int, dict[str, float]] = {}
    for i, row in enumerate(ws.iter_rows(min_row=25, max_row=1397, min_col=34, max_col=39, values_only=True), start=1):
        vals = {}
        for key, v in (("Vss", row[0]), ("CL", row[1]), ("fu", row[5])):
            if isinstance(v, (int, float)) and v > 0:
                vals[key] = float(v)
        out[i] = vals
    return out


def sig(x: float, n: int = 3) -> float:
    """Round to n significant figures."""
    if x == 0:
        return 0.0
    from math import floor, log10
    return round(x, -int(floor(log10(abs(x)))) + (n - 1))
