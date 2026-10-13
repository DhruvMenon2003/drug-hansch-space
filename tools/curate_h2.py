#!/usr/bin/env python3
"""Curate the H2-receptor-antagonist (ATC A02BA) dataset: one row per drug x route of administration.

Writes site/receptor/data/h2.json and site/receptor/data/h2_provenance.csv.

    tools/curate_h2.py                       # fetch (disk-cached), then write both files
    tools/curate_h2.py --check               # no network: rebuild from the cache and fail unless the
                                             # bytes on disk are identical (also runs the formula self-test)
    tools/curate_h2.py --generated-utc T     # pin meta.generated_utc (env H2_GENERATED_UTC does the same)
    tools/curate_h2.py --cache DIR --out DIR # other paths

THE ONE RULE: no experimental number is ever invented, estimated or recalled from memory. Every value
carries the URL it was read from, the literal sentence it was read from and the UTC time that URL was
fetched. A value that no fetched source states stays null and is listed in gaps[] with the reason.

Sources (all public domain except ChEMBL, which is CC BY-SA 3.0; DrugBank-sourced PubChem annotations are
excluded on purpose - see docs/SOURCES.md and docs/LICENSING-NOTES.md):
  WHO ATC/DDD index  routes (Adm.R) and DDDs per ATC code
  PubChem PUG REST   CID resolution, SMILES, formula, InChIKey
  PubChem PUG-View   HSDB pharmacokinetic sentences (fallback when the FDA label is silent)
  openFDA / DailyMed US labels: bioavailability, half-life, regimen, Vd, protein binding, animal LD50
  ChEMBL REST        in vitro potency at CHEMBL1941, in vivo ED50, in vivo/in vitro toxicity

Conventions reused from the sibling repo's curation/merge.py (one row per drug x mode of administration,
orthogonal assays = different ChEMBL assay AND different document, same units, in vitro never mixed with
in vivo, in vivo toxicity matched to the row's OWN route, therapeutic_index from a route- and
species-matched pair). Route codes are normalised WHO -> FDA with that repo's who_to_fda_route.csv and
carry the FDA code and NCI concept id from its fda_route_of_administration.tsv.

Route is treated as a QSAR condition the QSAR-Co way (Ambure et al., J. Chem. Inf. Model. 2019, 59,
2538-2544): every RDKit descriptor is emitted raw and as a Box-Jenkins deviation from the mean of the
compounds sharing that route, and the per-route means are emitted too (QSAR-Co's File1_AvgDesc.csv).

Deterministic: responses are cached on disk, every value's retrieved_utc comes from its cache entry, the
only clock reading is meta.generated_utc, floats are rounded, JSON keys are sorted. Python 3 standard
library only, plus rdkit for the descriptors.
"""
import argparse
import csv
import html as html_mod
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SIB = "/home/user/drug-toxicity-qsar-prediction/curation/inputs"
DEFAULT_OUT = os.path.join(ROOT, "site", "receptor", "data")
DEFAULT_CACHE = os.path.join(ROOT, ".h2_cache")
UA = "drug-hansch-space/curate_h2.py (+https://github.com/DhruvMenon2003/drug-hansch-space)"
CHEMBL_TARGET = "CHEMBL1941"
METHOD_CITATION = (
    "Box-Jenkins moving-average transform of descriptors under an experimental condition, after "
    "P. Ambure, A. K. Halder, H. Gonzalez-Diaz, M. N. D. S. Cordeiro, QSAR-Co: An Open Source "
    "Software for Developing Robust Multitasking or Multitarget Classification-Based QSAR Models, "
    "J. Chem. Inf. Model. 2019, 59, 2538-2544, doi:10.1021/acs.jcim.9b00295. The condition here is the "
    "mode of administration: dev_D_i(c) = D_i - mean(D over all compounds sharing route c)."
)

# ------------------------------------------------------------------------------------------- drug set
# cid: the PubChem CID the user's source sheet gives; None = resolve from PubChem by name.
DRUGS = [
    {"name": "cimetidine", "atc": "A02BA01", "cid": 2756, "source": "user_source_sheet"},
    {"name": "ranitidine", "atc": "A02BA02", "cid": None, "source": "added_outside_source_sheet",
     "added_note": "Not in the user's source sheet. Withdrawn from many markets over NDMA contamination; "
                   "included because ATC A02BA02 is part of the H2-receptor-antagonist class."},
    {"name": "famotidine", "atc": "A02BA03", "cid": 5702160, "source": "user_source_sheet"},
    {"name": "nizatidine", "atc": "A02BA04", "cid": 3033637, "source": "user_source_sheet"},
    {"name": "roxatidine", "atc": "A02BA06", "cid": None, "source": "added_outside_source_sheet",
     "added_note": "Not in the user's source sheet. ATC A02BA06; marketed in Japan and parts of Europe, "
                   "no US label."},
    {"name": "lafutidine", "atc": "A02BA08", "cid": None, "source": "added_outside_source_sheet",
     "added_note": "Not in the user's source sheet. ATC A02BA08; marketed in Japan and India, no US label."},
]

LICENCES = {
    "atcddd.fhi.no": ("WHO ATC/DDD Index (WHO Collaborating Centre for Drug Statistics Methodology)",
                      "WHOCC terms of use; ATC/DDD index free for personal, non-commercial use"),
    "pubchem.ncbi.nlm.nih.gov": ("PubChem (NCBI/NLM)", "public domain (US Government work); third-party "
                                 "annotation records keep their own source's licence"),
    "api.fda.gov": ("openFDA drug label API (FDA)", "public domain (US Government work)"),
    "dailymed.nlm.nih.gov": ("DailyMed (NLM)", "public domain (US Government work)"),
    "www.ebi.ac.uk": ("ChEMBL (EMBL-EBI)", "CC BY-SA 3.0"),
}
# PubChem annotation sources this script refuses to take numbers from, and why.
EXCLUDED_ANNOTATION_SOURCES = {
    "DrugBank": "DrugBank terms restrict redistribution of derived data (see docs/LICENSING-NOTES.md item 1)",
}
ALLOWED_ANNOTATION_SOURCES = ["Hazardous Substances Data Bank (HSDB)"]

# ----------------------------------------------------------------------------------------- http layer


def _utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Fetcher:
    """GET with a disk cache, a per-host delay, and a provenance log. offline=True never touches the network."""

    MIN_INTERVAL = {"pubchem.ncbi.nlm.nih.gov": 0.25, "www.ebi.ac.uk": 1.0, "api.fda.gov": 0.4,
                    "dailymed.nlm.nih.gov": 0.4, "atcddd.fhi.no": 0.5}

    def __init__(self, cache_dir, offline=False):
        self.cache_dir, self.offline = cache_dir, offline
        self.log, self._last = {}, {}
        os.makedirs(cache_dir, exist_ok=True)

    def _path(self, url):
        import hashlib
        return os.path.join(self.cache_dir, hashlib.sha256(url.encode()).hexdigest()[:40] + ".json")

    def get(self, url, purpose="", allow_404=False):
        """Return (body_text, entry). entry has status and retrieved_utc; body is '' for an allowed 404."""
        import hashlib
        path = self._path(url)
        entry = None
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                entry = json.load(f)
        if entry is None:
            if self.offline:
                raise RuntimeError(f"--check is offline and {url} is not in the cache; run without --check first")
            host = urllib.parse.urlsplit(url).netloc
            gap = self.MIN_INTERVAL.get(host, 0.5)
            wait = gap - (time.monotonic() - self._last.get(host, -1e9))
            if wait > 0:
                time.sleep(wait)
            status, body = 0, ""
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
                    with urllib.request.urlopen(req, timeout=120) as r:
                        status, body = r.status, r.read().decode("utf-8", "replace")
                    break
                except urllib.error.HTTPError as e:
                    status, body = e.code, e.read().decode("utf-8", "replace")
                    if status in (404, 400) or attempt == 2:
                        break
                    time.sleep(2 + 3 * attempt)
                except (urllib.error.URLError, OSError, TimeoutError) as e:
                    status, body = -1, f"{type(e).__name__}: {e}"
                    if attempt == 2:
                        break
                    time.sleep(2 + 3 * attempt)
            self._last[host] = time.monotonic()
            entry = {"url": url, "status": status, "retrieved_utc": _utc_now(), "body": body}
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(entry, f)
            os.replace(tmp, path)
        host = urllib.parse.urlsplit(url).netloc
        name, lic = LICENCES.get(host, (host, "unknown"))
        self.log[url] = {"url": url, "source": name, "licence": lic, "status": entry["status"],
                         "bytes": len(entry["body"].encode("utf-8")),
                         "sha256": hashlib.sha256(entry["body"].encode("utf-8")).hexdigest()[:16],
                         "retrieved_utc": entry["retrieved_utc"], "purpose": purpose}
        if entry["status"] != 200:
            if allow_404 and entry["status"] in (404, 400):
                return "", entry
            raise RuntimeError(f"{url} -> HTTP {entry['status']}")
        return entry["body"], entry

    def get_json(self, url, purpose="", allow_404=False):
        body, entry = self.get(url, purpose, allow_404)
        if body == "":
            return None, entry
        try:
            return json.loads(body), entry
        except json.JSONDecodeError as e:
            raise RuntimeError(f"{url} -> not JSON: {e}")


# -------------------------------------------------------------------------------------- text utilities
WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
            "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
            "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
            "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}


def squash(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def quote_of(text, start, end, pad=0):
    """The literal source text for a match, trimmed to sentence-ish bounds and <= 400 chars."""
    a, b = max(0, start - pad), min(len(text), end + pad)
    while a > 0 and text[a - 1] not in ".;\n":
        a -= 1
    while b < len(text) and text[b - 1] not in ".;\n":
        b += 1
    q = squash(text[a:b])
    return q[:400]


def words_to_numbers(text):
    """Replace spelled-out numbers with digits so '(Fifteen|Sixty-five) to 20%' parses. Length-preserving-ish."""
    def one(m):
        w = m.group(0)
        parts = re.split(r"[- ]", w.lower())
        if len(parts) == 2 and parts[0] in WORD_NUM and parts[1] in WORD_NUM and WORD_NUM[parts[0]] >= 20:
            return str(WORD_NUM[parts[0]] + WORD_NUM[parts[1]])
        return str(WORD_NUM[parts[0]]) if parts[0] in WORD_NUM else w
    keys = sorted(WORD_NUM, key=len, reverse=True)
    pat = r"\b(?:" + "|".join(keys) + r")(?:[- ](?:" + "|".join(keys) + r"))?\b"
    return re.sub(pat, one, text, flags=re.I)


def num(s):
    return float(s.replace(",", ""))


def sentences(text):
    """Split on sentence ends, keeping each piece's offset in the original text."""
    out, start = [], 0
    for m in re.finditer(r"(?<=[.;])\s+|\n+", text):
        if m.start() > start:
            out.append((start, text[start:m.start()]))
        start = m.end()
    if start < len(text):
        out.append((start, text[start:]))
    return out


# ------------------------------------------------------------------------------- value records and math
def val(value, unit, source_url, quote, retrieved_utc, *, relation="=", source_name=None, basis=None,
        low=None, high=None, extra=None):
    """A sourced value. value/unit/source_url/quote/retrieved_utc are always present; the rest when known."""
    rec = {"value": value, "unit": unit, "source_url": source_url, "quote": squash(quote)[:400],
           "retrieved_utc": retrieved_utc, "relation": relation}
    if source_name:
        rec["source_name"] = source_name
    if basis:
        rec["basis"] = basis
    if low is not None and high is not None and low != high:
        rec["range"] = [rnd(low), rnd(high)]
    if extra:
        rec.update(extra)
    rec["value"] = rnd(rec["value"])
    return rec


def rnd(x, places=6):
    if isinstance(x, bool) or x is None or isinstance(x, str):
        return x
    if isinstance(x, int):
        return x
    v = round(float(x), places)
    return 0.0 if v == 0 else v


def combine_relation(records):
    """Relation of a product/quotient of sourced terms. None when bounds point both ways."""
    rels = {r["relation"] for r in records}
    if rels <= {"="}:
        return "="
    if rels <= {"=", "~"}:
        return "~"
    if ">" in rels and "<" in rels:
        return None
    if ">" in rels:
        return ">"
    if "<" in rels:
        return "<"
    return "~"


def therapeutic_index(toxicity_invivo, activity_invivo):
    """The user's spreadsheet definition: log10(toxicity) - log10(1 / activity). Both terms must be > 0."""
    if toxicity_invivo is None or activity_invivo is None:
        return None
    if toxicity_invivo <= 0 or activity_invivo <= 0:
        return None
    return math.log10(toxicity_invivo) - math.log10(1.0 / activity_invivo)


def free_conc(F, t_half_h, dose_mg, tau_h):
    """The user's spreadsheet definition: 1.44 * F * t_half * Dose / tau."""
    for x in (F, t_half_h, dose_mg, tau_h):
        if x is None:
            return None
    if tau_h <= 0:
        return None
    return 1.44 * F * t_half_h * dose_mg / tau_h


def _selftest():
    """Prove the two derived formulas are what the brief defines, on numbers chosen here (not sourced)."""
    assert abs(therapeutic_index(100.0, 10.0) - 3.0) < 1e-12, "TI must be log10(tox)+log10(act)"
    assert therapeutic_index(100.0, None) is None and therapeutic_index(0.0, 1.0) is None
    assert abs(free_conc(0.5, 2.0, 400.0, 24.0) - (1.44 * 0.5 * 2.0 * 400.0 / 24.0)) < 1e-12
    assert abs(free_conc(0.5, 2.0, 400.0, 24.0) - 24.0) < 1e-12
    assert free_conc(None, 2.0, 400.0, 24.0) is None and free_conc(1.0, 1.0, 1.0, 0.0) is None
    assert combine_relation([{"relation": "="}, {"relation": "~"}]) == "~"
    assert combine_relation([{"relation": ">"}, {"relation": "="}]) == ">"
    assert combine_relation([{"relation": ">"}, {"relation": "<"}]) is None
    assert words_to_numbers("Fifteen to 20% and Sixty-five to 70%").startswith("15 to 20%")
    assert abs(_percent_range("is 40 to 45%")[0] - 42.5) < 1e-9
    return True


# ------------------------------------------------------------------------------------ number scanning
QUAL_UP = r"(?:exceeds|exceed|greater than|more than|at least|over|>=?)"
QUAL_DOWN = r"(?:less than|below|under|up to|<=?)"
QUAL_APPROX = r"(?:about|approximately|approx\.?|roughly|around|averages?|averaged|mean|nearly|some)"
RANGE_SEP = r"(?:\s*(?:to|-|–|—)\s*)"


def _qual_relation(q):
    q = (q or "").strip().lower()
    if not q:
        return "="
    if re.fullmatch(QUAL_UP, q, re.I):
        return ">"
    if re.fullmatch(QUAL_DOWN, q, re.I):
        return "<"
    return "~"


def _percent_range(frag):
    """First percentage (range or single) in frag -> (value, low, high, relation) or None."""
    m = re.search(r"(?P<q>" + QUAL_UP + r"|" + QUAL_DOWN + r"|" + QUAL_APPROX + r")?\s*(?P<a>\d[\d.,]*)"
                  + RANGE_SEP + r"(?P<b>\d[\d.,]*)\s*%", frag, re.I)
    if m:
        a, b = num(m.group("a")), num(m.group("b"))
        return (a + b) / 2.0, a, b, "~"
    m = re.search(r"(?P<q>" + QUAL_UP + r"|" + QUAL_DOWN + r"|" + QUAL_APPROX + r")?\s*(?P<a>\d[\d.,]*)\s*%",
                  frag, re.I)
    if m:
        a = num(m.group("a"))
        return a, a, a, _qual_relation(m.group("q"))
    return None


def _unit_quantity(frag, unit_pat):
    """First quantity with the given unit pattern in frag -> (value, low, high, relation, unit) or None."""
    m = re.search(r"(?P<q>" + QUAL_UP + r"|" + QUAL_DOWN + r"|" + QUAL_APPROX + r")?\s*(?P<a>\d[\d.,]*)"
                  + RANGE_SEP + r"(?P<b>\d[\d.,]*)\s*(?P<u>" + unit_pat + r")\b", frag, re.I)
    if m:
        a, b = num(m.group("a")), num(m.group("b"))
        return (a + b) / 2.0, a, b, "~", m.group("u")
    m = re.search(r"(?P<q>" + QUAL_UP + r"|" + QUAL_DOWN + r"|" + QUAL_APPROX + r")?\s*(?P<a>\d[\d.,]*)\s*"
                  r"(?P<u>" + unit_pat + r")\b", frag, re.I)
    if m:
        a = num(m.group("a"))
        return a, a, a, _qual_relation(m.group("q")), m.group("u")
    return None


# --------------------------------------------------------------------------------------- PK extractors
# A sentence about a special population does not describe the drug's ordinary parameter.
POP_GUARD = re.compile(r"\b(?:pediatric|paediatric|children|child|neonat|infant|geriatric|elderly|"
                       r"renal (?:impairment|insufficiency|dysfunction|failure)|anephric|creatinine "
                       r"clearance|cirrho|hepatic (?:dysfunction|impairment)|dialysis|haemodialysis|"
                       r"hemodialysis)\b", re.I)
# Only sentences that describe a reduced-function population are dropped; the 'N mg' regex itself
# refuses mg/kg and mg/day, and the FIRST match in a sentence is the recommended dose, not a maximum.
DOSE_GUARD = re.compile(r"\b(?:renal (?:impairment|insufficiency|dysfunction|failure)|creatinine "
                        r"clearance|dialysis|haemodialysis|hemodialysis)\b", re.I)
HALF_LIFE = re.compile(r"half[-\s]?(?:life|time)", re.I)


def pick_sentence(text, keyword_re, guard=POP_GUARD, prefer=None):
    """Sentences mentioning keyword_re, guard-free, document order; `prefer`-matching ones first."""
    hits = [(off, s) for off, s in sentences(text) if keyword_re.search(s) and not (guard and guard.search(s))]
    if prefer is not None:
        hits.sort(key=lambda t: (0 if prefer.search(t[1]) else 1, t[0]))
    return hits


def extract_F(text):
    """Bioavailability / fraction absorbed as a fraction of 1."""
    for off, s in pick_sentence(text, re.compile(r"bioavailab|absorbed|absorption", re.I)):
        sn = words_to_numbers(s)
        for pat in (r"bioavailab\w*[^.%]{0,90}?(?P<frag>(?:" + QUAL_UP + r"|" + QUAL_DOWN + r"|"
                    + QUAL_APPROX + r")?\s*\d[\d.,]*(?:" + RANGE_SEP + r"\d[\d.,]*)?\s*%)",
                    r"(?P<frag>(?:" + QUAL_APPROX + r")?\s*\d[\d.,]*\s*%)\s*absorbed"):
            m = re.search(pat, sn, re.I)
            if not m:
                continue
            pr = _percent_range(m.group("frag"))
            if pr is None or not 0 < pr[0] <= 100:
                continue
            v, lo, hi, rel = pr
            return {"value": v / 100.0, "low": lo / 100.0, "high": hi / 100.0, "relation": rel,
                    "unit": "fraction of dose", "quote": squash(s)}
    return None


def extract_t_half(text):
    for off, s in pick_sentence(text, HALF_LIFE):
        sn = words_to_numbers(s)
        for pat in (r"half[-\s]?(?:life|time)[^.]{0,70}?(?P<frag>(?:" + QUAL_APPROX + r"|" + QUAL_UP
                    + r"|" + QUAL_DOWN + r")?\s*\d[\d.,]*(?:" + RANGE_SEP + r"\d[\d.,]*)?\s*"
                    r"(?:hours?|hrs?|hr|h)\b)",
                    r"(?P<frag>\d[\d.,]*(?:" + RANGE_SEP + r"\d[\d.,]*)?\s*(?:hours?|hrs?)\b)"
                    r"[^.]{0,50}half[-\s]?(?:life|time)"):
            m = re.search(pat, sn, re.I)
            if not m:
                continue
            q = _unit_quantity(m.group("frag"), r"hours?|hrs?|hr|h")
            if q is None or not 0 < q[0] < 500:
                continue
            v, lo, hi, rel, _ = q
            return {"value": v, "low": lo, "high": hi, "relation": rel, "unit": "h", "quote": squash(s)}
    return None


FREQ = [(r"every\s+(\d+)\s*(?:to\s*\d+\s*)?hours?", None), (r"q\.?\s?6\s?h", 6.0), (r"q\.?\s?8\s?h", 8.0),
        (r"q\.?\s?12\s?h", 12.0), (r"q\.?\s?24\s?h", 24.0),
        (r"(?:four|4)\s+times\s+(?:a\s+day|daily|per\s+day)", 6.0), (r"q\.?i\.?d\.?", 6.0),
        (r"(?:three|3)\s+times\s+(?:a\s+day|daily|per\s+day)", 8.0), (r"t\.?i\.?d\.?", 8.0),
        (r"(?:twice|two\s+times)\s+(?:a\s+day|daily|per\s+day)", 12.0), (r"b\.?i\.?d\.?", 12.0),
        (r"twice\s+daily", 12.0), (r"once\s+daily", 24.0), (r"once\s+a\s+day", 24.0),
        (r"at\s+bedtime", 24.0), (r"once\s+every\s+24\s*hours?", 24.0), (r"daily", 24.0)]
FREQ_RE = re.compile(r"|".join("(?:" + p + ")" for p, _ in FREQ), re.I)


def _tau_from(freq_text):
    for pat, hours in FREQ:
        m = re.fullmatch(pat, freq_text.strip(), re.I)
        if m:
            if hours is not None:
                return hours, f"'{squash(freq_text)}' = {hours:g} h between doses"
            n = float(m.group(1))
            return (n, f"'{squash(freq_text)}' = {n:g} h between doses") if 0 < n <= 168 else (None, None)
    return None, None


def extract_regimen(text):
    """An explicit 'N mg <frequency>' adult regimen -> dose_mg and tau_h, label sentences preferred."""
    prefer = re.compile(r"recommend", re.I)
    for off, s in pick_sentence(text, re.compile(r"\bmg\b", re.I), guard=DOSE_GUARD, prefer=prefer):
        m = re.search(r"(?P<d>\d[\d,]*(?:\.\d+)?)\s*mg(?![/\w])[^.;]{0,30}?(?P<f>" + FREQ_RE.pattern + r")",
                      s, re.I)
        if not m:
            continue
        dose = num(m.group("d"))
        tau, tau_basis = _tau_from(m.group("f"))
        if tau is None or not 0 < dose <= 10000:
            continue
        return {"dose": dose, "tau": tau, "tau_basis": tau_basis, "quote": squash(s),
                "preferred": bool(prefer.search(s))}
    return None


def extract_vd(text):
    for off, s in pick_sentence(text, re.compile(r"volume of distribution", re.I)):
        sn = words_to_numbers(s)
        m = re.search(r"volume of distribution[^.]{0,80}?(?P<frag>(?:" + QUAL_APPROX + r")?\s*\d[\d.,]*"
                      r"(?:" + RANGE_SEP + r"\d[\d.,]*)?\s*(?:l/kg|liters?/kg|litres?/kg|l\b|liters?\b|litres?\b))",
                      sn, re.I)
        if not m:
            continue
        q = _unit_quantity(m.group("frag"), r"l/kg|liters?/kg|litres?/kg|l|liters?|litres?")
        if q is None or not 0 < q[0] < 1000:
            continue
        v, lo, hi, rel, u = q
        unit = "L/kg" if "kg" in u.lower() else "L"
        return {"value": v, "low": lo, "high": hi, "relation": rel, "unit": unit, "quote": squash(s)}
    return None


def extract_fu(text):
    """fraction_unbound = 1 - plasma protein binding read from the sentence."""
    kw = re.compile(r"protein[- ]bound|bound to plasma protein|protein binding", re.I)
    for off, s in pick_sentence(text, kw):
        sn = words_to_numbers(s)
        pats = [r"(?P<frag>\d[\d.,]*" + RANGE_SEP + r"\d[\d.,]*\s*%)[^.]{0,45}?(?:protein[- ]bound|"
                r"bound to plasma protein|protein binding)",
                r"(?P<frag>(?:" + QUAL_APPROX + r")?\s*\d[\d.,]*\s*%)[^.]{0,45}?(?:is|are)\s+"
                r"(?:bound to plasma protein|protein[- ]bound)",
                r"(?:protein[- ]bound|bound to plasma protein|protein binding)[^.]{0,45}?"
                r"(?P<frag>(?:" + QUAL_APPROX + r")?\s*\d[\d.,]*(?:" + RANGE_SEP + r"\d[\d.,]*)?\s*%)"]
        for pat in pats:
            m = re.search(pat, sn, re.I)
            if not m:
                continue
            pr = _percent_range(m.group("frag"))
            if pr is None or not 0 <= pr[0] <= 100:
                continue
            pb, lo, hi, rel = pr
            flip = {"=": "=", "~": "~", ">": "<", "<": ">"}[rel]
            return {"value": 1.0 - pb / 100.0, "low": 1.0 - hi / 100.0, "high": 1.0 - lo / 100.0,
                    "relation": flip, "unit": "fraction unbound", "quote": squash(s),
                    "pb_percent": pb}
    return None


SPECIES = [("rat", r"\brats?\b|\bwistar\b|\bsprague"), ("mouse", r"\bmice\b|\bmouse\b"),
           ("dog", r"\bdogs?\b|heidenhain"), ("monkey", r"\bmonkeys?\b"), ("rabbit", r"\brabbits?\b"),
           ("guinea pig", r"\bguinea[- ]pigs?\b")]
# Longest / most specific route words first so 'intraperitoneal' never reads as oral or intravenous.
ROUTE_WORDS = [("intraperitoneal", r"intraperitoneal(?:ly)?|\bi\.?\s?p\.?\b"),
               ("intraduodenal", r"intraduodenal(?:ly)?|\bi\.?\s?d\.?\b"),
               ("intracerebroventricular", r"intracerebroventricular(?:ly)?|\bicv\b"),
               ("subcutaneous", r"subcutaneous(?:ly)?|\bs\.?\s?c\.?\b"),
               ("intramuscular", r"intramuscular(?:ly)?|\bi\.?\s?m\.?\b"),
               ("intravenous", r"intravenous(?:ly)?|\bi\.?\s?v\.?\b|\biv\b"),
               ("oral", r"per\s?oral(?:ly)?|peroral(?:ly)?|orally|\boral\b|\bp\.?\s?o\.?\b|\bpo\b|"
                        r"per os|gavage|by mouth")]


def species_of(text):
    t = (text or "").lower()
    best = None
    for name, pat in SPECIES:
        m = re.search(pat, t, re.I)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    return best[1] if best else None


def route_of(text):
    """The experimental route a free-text assay description or label sentence states, or None."""
    t = (text or "")
    best = None
    for name, pat in ROUTE_WORDS:
        m = re.search(pat, t, re.I)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    return best[1] if best else None


# FDA route of the row <- experimental route of the record. A coarse PARENTERAL row accepts the
# injection routes FDA's own definition covers ("injection, infusion, or implantation").
ROUTE_ACCEPTS = {
    "ORAL": {"oral"},
    "PARENTERAL": {"intravenous", "intramuscular", "subcutaneous"},
    "INTRAVENOUS": {"intravenous"},
    "INTRAMUSCULAR": {"intramuscular"},
    "SUBCUTANEOUS": {"subcutaneous"},
}


def extract_ld50(text):
    """Route- and species-tagged lethal doses stated in a label sentence (mg/kg only)."""
    out = []
    for off, s in sentences(text):
        if not re.search(r"LD\s?50|median lethal|not lethal|lethal dose", s, re.I):
            continue
        s_clean = re.sub(r"LD\s?50", "LDFIFTY", s, flags=re.I)
        rel = ">" if re.search(r"not lethal|non-?lethal", s_clean, re.I) else "="
        route = route_of(s_clean)
        # 'A and B mg/kg' states two values; 'mg/kg/day' is a repeated dose, not a lethal dose.
        nums = []
        for m in re.finditer(r"((?:\d[\d,]*(?:\.\d+)?\s*(?:,|and|or)\s*)*\d[\d,]*(?:\.\d+)?)\s*mg/kg(?!/)",
                             s_clean):
            nums += [num(x) for x in re.split(r"\s*(?:,|and|or)\s*", m.group(1)) if x.strip()]
        if not nums:
            continue
        sp = []
        for m in re.finditer(r"|".join(p for _, p in SPECIES), s_clean, re.I):
            name = species_of(m.group(0))
            if name and name not in sp:
                sp.append(name)
        if not sp:
            sp = [None]
        if len(nums) == len(sp):
            pairs = list(zip(nums, sp))
        elif len(nums) == 1:
            pairs = [(nums[0], x) for x in sp]
        elif len(sp) == 1:
            pairs = [(n, sp[0]) for n in nums]
        else:
            continue
        for v, species in pairs:
            out.append({"value": v, "unit": "mg/kg", "relation": rel, "species": species,
                        "route": route, "quote": squash(s), "endpoint": "LD50"})
    return out


# ---------------------------------------------------------------------------------- local input tables
def load_route_vocab():
    """WHO Adm.R -> FDA route, and the FDA route vocabulary with its code and NCI concept id."""
    who2fda, fda = {}, {}
    p1 = os.path.join(SIB, "who_to_fda_route.csv")
    p2 = os.path.join(SIB, "fda_route_of_administration.tsv")
    with open(p1, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            who2fda[row["who_admr"]] = {"fda_route": row["fda_route"], "confidence": row["confidence"],
                                        "note": row["note"]}
    with open(p2, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            fda[row["NAME"].strip()] = {"fda_code": row["FDA CODE"].strip(),
                                        "nci_concept_id": row["NCI CONCEPT ID"].strip(),
                                        "short_name": row["SHORT NAME"].strip(),
                                        "definition": squash(row["DEFINITION"])}
    return who2fda, fda, p1, p2


def load_admr_md(names):
    """The WHO AdmR rows of the sibling repo's mode_of_administration.md, for cross-checking."""
    p = os.path.join(SIB, "mode_of_administration.md")
    out = {}
    with open(p, encoding="utf-8") as f:
        for line in f:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) != 4 or cells[0] in ("CID", "---"):
                continue
            cid, name, atc, admr = cells
            if name.replace(".", " ") in names or name in names:
                out.setdefault(name, {"cid": cid, "atc": atc, "admr": []})["admr"].append(admr)
    return out, p


# ------------------------------------------------------------------------------------------ WHO ATC/DDD
WHO_URL = "https://atcddd.fhi.no/atc_ddd_index/?code={}&showdescription=no"
WHO_DDD_DEF_URL = "https://atcddd.fhi.no/ddd/definition_and_general_considera/"


def who_atc_table(fetcher, group="A02BA"):
    """{atc_code: {'name':.., 'ddd':[{'ddd':float,'unit':str,'admr':str,'row_text':str}]}} from the index page."""
    url = WHO_URL.format(group)
    html, entry = fetcher.get(url, f"WHO ATC/DDD index: routes (Adm.R) and DDDs for {group}")
    m = re.search(r"<table[^>]*>(.*?)</table>", html, re.S)
    if not m:
        raise RuntimeError(f"{url}: no ATC table in the page")
    out, current = OrderedDict(), None
    for tr in re.findall(r"<tr>(.*?)</tr>", m.group(1), re.S):
        cells = [squash(html_mod.unescape(re.sub(r"<[^>]+>", " ", c)).replace("\xa0", " "))
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) < 5 or cells[0] == "ATC code":
            continue
        code, name, ddd, unit, admr = cells[0], cells[1], cells[2], cells[3], cells[4]
        if code:
            current = code
            out[code] = {"name": name, "ddd": []}
        if current is None:
            continue
        if admr:
            rec = {"admr": admr, "ddd": None, "unit": None,
                   "row_text": f"{current} | {out[current]['name']} | DDD {ddd or '-'} | U {unit or '-'} | Adm.R {admr}"}
            try:
                rec["ddd"] = float(ddd)
                rec["unit"] = unit
            except ValueError:
                pass
            out[current]["ddd"].append(rec)
    return out, url, entry


def who_ddd_definition(fetcher):
    html, entry = fetcher.get(WHO_DDD_DEF_URL, "WHO definition of the DDD (so the DDD is never read as a dose)")
    text = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    text = squash(html_mod.unescape(re.sub(r"<[^>]+>", " ", text)).replace("\xa0", " "))
    m = re.search(r"The DDD is the assumed average maintenance dose[^.]*\.\s*"
                  r"The DDD is a unit of measurement[^.]*\.", text)
    return (squash(m.group(0)) if m else None), WHO_DDD_DEF_URL, entry


# -------------------------------------------------------------------------------------------- PubChem
PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PUGVIEW = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound"
PC_PROPS = "SMILES,ConnectivitySMILES,MolecularFormula,MolecularWeight,InChIKey,IUPACName,Title"


def pubchem_cid(fetcher, name):
    url = f"{PUG}/compound/name/{urllib.parse.quote(name)}/cids/JSON"
    data, entry = fetcher.get_json(url, f"PubChem: resolve CID for '{name}'")
    cids = (data or {}).get("IdentifierList", {}).get("CID") or []
    return (cids[0] if cids else None), url, entry


def pubchem_props(fetcher, cids):
    url = f"{PUG}/compound/cid/{','.join(str(c) for c in cids)}/property/{PC_PROPS}/JSON"
    data, entry = fetcher.get_json(url, "PubChem: SMILES, formula, InChIKey, title")
    return {int(p["CID"]): p for p in data["PropertyTable"]["Properties"]}, url, entry


HSDB_HEADINGS = ["Absorption, Distribution and Excretion", "Protein Binding", "Biological Half-Life"]


def pubchem_annotations(fetcher, cid, heading):
    """Allowed-source annotation strings under one PUG-View heading, in page order."""
    url = f"{PUGVIEW}/{cid}/JSON?heading={urllib.parse.quote(heading)}"
    data, entry = fetcher.get_json(url, f"PubChem PUG-View: '{heading}' annotations for CID {cid}",
                                   allow_404=True)
    if not data or "Record" not in data:
        return [], url, entry
    refs = {r.get("ReferenceNumber"): r for r in data["Record"].get("Reference", [])}
    out = []

    def walk(sec):
        if sec.get("TOCHeading") == heading:
            for info in sec.get("Information", []):
                ref = refs.get(info.get("ReferenceNumber"), {})
                src = ref.get("SourceName")
                if src not in ALLOWED_ANNOTATION_SOURCES:
                    continue
                for swm in info.get("Value", {}).get("StringWithMarkup", []) or []:
                    s = squash(swm.get("String", ""))
                    if s:
                        out.append({"text": s, "source_name": src,
                                    "source_record_url": ref.get("URL"), "heading": heading})
        for sub in sec.get("Section", []) or []:
            walk(sub)
    for sec in data["Record"].get("Section", []):
        walk(sec)
    return out, url, entry


# --------------------------------------------------------------------------------- openFDA and DailyMed
FDA_LABEL = "https://api.fda.gov/drug/label.json"
DAILYMED = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json"
LABEL_SECTIONS_PK = ["pharmacokinetics", "clinical_pharmacology", "description"]
LABEL_SECTIONS_DOSE = ["dosage_and_administration"]
LABEL_SECTIONS_TOX = ["overdosage", "nonclinical_toxicology",
                      "carcinogenesis_and_mutagenesis_and_impairment_of_fertility", "clinical_pharmacology"]


def _fda_url(search, **kw):
    q = [("search", search)] + sorted(kw.items())
    return FDA_LABEL + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


def openfda_route_facet(fetcher, name):
    url = _fda_url(f'openfda.generic_name:"{name}"', count="openfda.route.exact")
    data, entry = fetcher.get_json(url, f"openFDA: which routes have a US label for {name}", allow_404=True)
    rows = (data or {}).get("results") or []
    return {r["term"]: r["count"] for r in rows}, url, entry


def openfda_labels(fetcher, name, fda_route, limit=5):
    """Candidate labels for one drug x route, newest effective_time first. [] when no such label exists."""
    out, urls = [], []
    searches = [f'openfda.generic_name:"{name}" AND openfda.route:"{fda_route}" AND _exists_:pharmacokinetics',
                f'openfda.generic_name:"{name}" AND openfda.route:"{fda_route}"']
    seen = set()
    for search in searches:
        url = _fda_url(search, limit=str(limit), sort="effective_time:desc")
        urls.append(url)
        data, entry = fetcher.get_json(url, f"openFDA label: {name} / {fda_route}", allow_404=True)
        for r in sorted((data or {}).get("results") or [],
                        key=lambda r: (-int(r.get("effective_time") or 0), r.get("id") or "")):
            sid = r.get("set_id") or r.get("id")
            if sid in seen:
                continue
            seen.add(sid)
            out.append({"set_id": sid, "spl_id": r.get("id"), "effective_time": r.get("effective_time"),
                        "query_url": url, "retrieved_utc": entry["retrieved_utc"],
                        "label_url": f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={r.get('set_id')}",
                        "sections": {k: squash(" ".join(v)) for k, v in r.items() if isinstance(v, list)
                                     and v and all(isinstance(x, str) for x in v)}})
    return out, urls


def dailymed_count(fetcher, name):
    url = DAILYMED + "?" + urllib.parse.urlencode(sorted({"drug_name": name, "pagesize": "5"}.items()))
    data, entry = fetcher.get_json(url, f"DailyMed: how many US SPLs name {name}", allow_404=True)
    md = (data or {}).get("metadata") or {}
    return md.get("total_elements"), url, entry


# ------------------------------------------------------------------------------------------- ChEMBL
CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
TOX_TYPES = "LD50,TD50,CC50,TC50,NOAEL,LOAEL"


def chembl_molecule(fetcher, name):
    url = f"{CHEMBL}/molecule.json?pref_name__iexact={urllib.parse.quote(name.upper())}&limit=5"
    data, entry = fetcher.get_json(url, f"ChEMBL: molecule record for {name}", allow_404=True)
    mols = (data or {}).get("molecules") or []
    if not mols:
        return None, url, entry
    m = sorted(mols, key=lambda x: x["molecule_chembl_id"])[0]
    st = m.get("molecule_structures") or {}
    return {"molecule_chembl_id": m["molecule_chembl_id"], "pref_name": m.get("pref_name"),
            "max_phase": m.get("max_phase"), "withdrawn_flag": m.get("withdrawn_flag"),
            "inchikey": st.get("standard_inchi_key"), "smiles": st.get("canonical_smiles")}, url, entry


def chembl_activities(fetcher, params, purpose):
    url = f"{CHEMBL}/activity.json?" + urllib.parse.urlencode(sorted(params.items())) + "&limit=200"
    data, entry = fetcher.get_json(url, purpose, allow_404=True)
    return ((data or {}).get("activities") or []), url, entry


def usable(rec):
    return (rec.get("standard_value") not in (None, "") and not rec.get("data_validity_comment")
            and not rec.get("potential_duplicate"))


def sort_key(rec):
    return (-(rec.get("document_year") or 0), rec.get("assay_chembl_id") or "", rec.get("activity_id") or 0)


def pick_orthogonal(records, prefer_distinct_type=False):
    """merge.py's rule: up to 2 records from a DIFFERENT assay AND a DIFFERENT document (readout too, if asked)."""
    recs = sorted([r for r in records if usable(r)], key=sort_key)
    if not recs:
        return []
    first = recs[0]

    def ok(r, strict):
        diff = (r.get("assay_chembl_id") != first.get("assay_chembl_id")
                and r.get("document_chembl_id") != first.get("document_chembl_id"))
        return diff and (not strict or r.get("standard_type") != first.get("standard_type"))
    for strict in ([True, False] if prefer_distinct_type else [False]):
        for r in recs[1:]:
            if ok(r, strict):
                return [first, r]
    return [first]


def chembl_url_assay(assay_id):
    return f"{CHEMBL}/assay/{assay_id}"


def act_record(rec, source_url, retrieved_utc, *, context, route_match=None, species=None, basis=None):
    unit = {"nM": "nM", "mg.kg-1": "mg/kg", "ug.mL-1": "ug/mL", "uM": "uM", "M": "M",
            "umol.kg-1": "umol/kg", "nmol": "nmol"}.get(rec.get("standard_units"), rec.get("standard_units"))
    extra = {"standard_type": rec.get("standard_type"), "context": context,
             "assay_chembl_id": rec.get("assay_chembl_id"),
             "document_chembl_id": rec.get("document_chembl_id"),
             "document_year": rec.get("document_year"), "activity_id": rec.get("activity_id"),
             "assay_description": squash(rec.get("assay_description"))[:300],
             "assay_url": chembl_url_assay(rec.get("assay_chembl_id")),
             "target_chembl_id": rec.get("target_chembl_id"),
             "pchembl_value": rec.get("pchembl_value")}
    if route_match:
        extra["route_match"] = route_match
    if species:
        extra["species"] = species
    return val(float(rec["standard_value"]), unit, source_url, squash(rec.get("assay_description")),
               retrieved_utc, relation=(rec.get("standard_relation") or "="),
               source_name="ChEMBL (EMBL-EBI), CC BY-SA 3.0", basis=basis, extra=extra)


# --------------------------------------------------------------------------------- RDKit descriptors
# The ten descriptors the brief asks for. Computed the same way as tools/build_data.py (same RDKit calls),
# so the two datasets are comparable. These are CALCULATED from the structure, not measured.
DESC_KEYS = ["logp", "mr", "tpsa", "mw", "hbd", "hba", "rotb", "arom", "fsp3", "qed"]
DESC_DOC = {
    "logp": "Crippen MolLogP (RDKit)", "mr": "Crippen molar refractivity (RDKit)",
    "tpsa": "Ertl topological polar surface area, N and O only (RDKit default)",
    "mw": "average molecular weight (RDKit Descriptors.MolWt)",
    "hbd": "Lipinski H-bond donors, NH + OH (RDKit CalcNumLipinskiHBD)",
    "hba": "Lipinski H-bond acceptors, N + O (RDKit CalcNumLipinskiHBA)",
    "rotb": "rotatable bonds (RDKit CalcNumRotatableBonds)",
    "arom": "aromatic rings (RDKit CalcNumAromaticRings)",
    "fsp3": "fraction of sp3 carbons (RDKit CalcFractionCSP3)",
    "qed": "quantitative estimate of drug-likeness (RDKit QED.qed, Bickerton et al. 2012)",
}


def descriptors(smiles):
    from rdkit import Chem, RDLogger
    from rdkit.Chem import Crippen, Descriptors, QED, rdMolDescriptors
    RDLogger.DisableLog("rdApp.*")
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return {"logp": Crippen.MolLogP(mol), "mr": Crippen.MolMR(mol),
            "tpsa": rdMolDescriptors.CalcTPSA(mol), "mw": Descriptors.MolWt(mol),
            "hbd": rdMolDescriptors.CalcNumLipinskiHBD(mol), "hba": rdMolDescriptors.CalcNumLipinskiHBA(mol),
            "rotb": rdMolDescriptors.CalcNumRotatableBonds(mol),
            "arom": rdMolDescriptors.CalcNumAromaticRings(mol),
            "fsp3": rdMolDescriptors.CalcFractionCSP3(mol), "qed": QED.qed(mol)}


def box_jenkins(rows):
    """QSAR-Co moving average: per-route descriptor means, and each row's deviation from its route's mean.
    dev_D_i(c) = D_i - mean(D over the compounds sharing condition c). One compound per (drug, route) row,
    so the mean is over the drugs that share the route."""
    by_route = OrderedDict()
    for r in rows:
        by_route.setdefault(r["route"]["fda_route"], []).append(r)
    means = OrderedDict()
    for route in sorted(by_route):
        group = by_route[route]
        drugs = sorted({g["drug"] for g in group})
        vals = {k: [g["descriptors"][k] for g in group if g["descriptors"]] for k in DESC_KEYS}
        means[route] = {"n_compounds": len(drugs), "drugs": drugs,
                        "means": {k: rnd(sum(v) / len(v)) if v else None for k, v in vals.items()}}
    for r in rows:
        m = means[r["route"]["fda_route"]]["means"]
        r["descriptor_deviations"] = ({k: rnd(r["descriptors"][k] - m[k]) for k in DESC_KEYS}
                                      if r["descriptors"] else None)
    return means


# ------------------------------------------------------------------------------------- derived columns
TI_FORMULA = "therapeutic_index = log10(toxicity_invivo) - log10(1 / activity_invivo)"
FC_FORMULA = "free_conc = 1.44 * F * t_half_h * dose_mg / tau_h"


def ti_basis_text(tox, act, value):
    """The honest caveat: when this expression is and is not log10(TD50/ED50)."""
    if tox is None or act is None:
        return (f"Not computed. The brief's expression is {TI_FORMULA}. It equals the standard "
                "log10(TD50/ED50) only when the activity term is a reciprocal-potency quantity "
                "(1/ED50, or an affinity such as 1/Kd in L/mol); with a potency expressed as a DOSE "
                "(ED50 in mg/kg) the subtraction of log10(1/ED50) ADDS log10(ED50), so the expression "
                "returns log10(TD50 x ED50), not a ratio. Both inputs must come from the row's own route, "
                "the same species and the same units, and neither was available here.")
    u = tox.get("unit")
    return (f"Computed as the brief defines it: {TI_FORMULA} = log10({tox['value']} {u}) "
            f"- log10(1 / {act['value']} {act.get('unit')}) = {value}. "
            f"The activity term is an in vivo {act.get('standard_type') or 'ED50'} in {act.get('unit')}, "
            "i.e. a DOSE: larger means less potent. Subtracting log10(1/ED50) therefore ADDS log10(ED50), "
            "so this number is log10(TD50 x ED50) and NOT the standard log10(TD50/ED50); the two agree only "
            "when the activity term is itself a reciprocal-potency quantity (1/ED50, or an affinity such as "
            "1/Kd in L/mol), which mg/kg is not. therapeutic_index_standard holds log10(TD50/ED50) for the "
            f"same pair. Both terms are {u}, in vivo, {species_phrase(tox, act)} and matched to this row's route.")


def species_phrase(tox, act):
    a, b = tox.get("species"), act.get("species")
    return f"species {a}" if a == b else f"species {a} (toxicity) and {b} (activity)"


def fc_basis_text(terms, value, unit_note):
    if value is None:
        missing = [k for k, v in terms.items() if v is None]
        return (f"Not computed; missing {', '.join(missing) or 'a usable term'}. The brief defines "
                f"{FC_FORMULA}. Note the name: F*Dose/tau is a dosing RATE in mg/h and 1.44*t_half = "
                "t_half/ln2 = 1/k_el is a time in h, so the product is an AMOUNT in mg (the average amount "
                "of drug in the body at steady state, F*Dose/(k_el*tau)) - an AUC-style exposure proxy, NOT "
                "a concentration. It becomes a free concentration only after division by the volume of "
                "distribution and multiplication by the unbound fraction.")
    return (f"Computed as the brief defines it: {FC_FORMULA} = 1.44 * {terms['F']} * {terms['t_half_h']} h "
            f"* {terms['dose_mg']} mg / {terms['tau_h']} h = {value}. The brief calls this an exposure proxy "
            "in mg*h; as written the units are mg, not mg*h (F*Dose/tau is a dosing rate in mg/h and "
            "1.44*t_half = t_half/ln2 = 1/k_el is a time in h), so the quantity is the average AMOUNT of "
            "drug in the body at steady state, F*Dose/(k_el*tau). It is an AUC-style exposure proxy and NOT "
            "a concentration: to get a free concentration divide by the volume of distribution and multiply "
            f"by the unbound fraction. {unit_note}")


# -------------------------------------------------------------------------------------- field plumbing
def from_labels(labels, sections, extractor):
    """First (extractor hit, label, section) over labels in order, sections in order."""
    for lab in labels:
        for sec in sections:
            txt = lab["sections"].get(sec)
            if not txt:
                continue
            hit = extractor(txt)
            if hit:
                return hit, lab, sec
    return None, None, None


def from_annotations(items, extractor):
    for it in items:
        hit = extractor(it["text"])
        if hit:
            return hit, it
    return None, None


def label_value(hit, lab, sec, *, unit=None, basis=None):
    return val(hit["value"], unit or hit["unit"], lab["query_url"], hit["quote"], lab["retrieved_utc"],
               relation=hit["relation"], source_name="openFDA drug label API (FDA), public domain",
               basis=basis, low=hit.get("low"), high=hit.get("high"),
               extra=dict({"spl_set_id": lab["set_id"], "spl_effective_time": lab["effective_time"],
                            "label_url": lab["label_url"], "label_section": sec},
                          **({"pb_percent": hit["pb_percent"]} if "pb_percent" in hit else {})))


def annotation_value(hit, item, url, retrieved_utc, *, unit=None, basis=None):
    return val(hit["value"], unit or hit["unit"], url, hit["quote"], retrieved_utc,
               relation=hit["relation"], source_name=f"{item['source_name']} via PubChem PUG-View",
               basis=basis, low=hit.get("low"), high=hit.get("high"),
               extra=dict({"pubchem_heading": item["heading"],
                            "source_record_url": item["source_record_url"]},
                          **({"pb_percent": hit["pb_percent"]} if "pb_percent" in hit else {})))


def pk_field(labels, hsdb, extractor, *, route_label, systemic_note):
    """A PK parameter: the row's own label first, then an HSDB sentence on the compound's PubChem record."""
    hit, lab, sec = from_labels(labels, LABEL_SECTIONS_PK, extractor)
    if hit:
        return label_value(hit, lab, sec, basis=f"read from the {route_label} label's {sec} section"), "label"
    hit, item = from_annotations(hsdb["items"], extractor)
    if hit:
        return annotation_value(hit, item, hsdb["urls"][item["heading"]],
                                hsdb["retrieved"][item["heading"]],
                                basis="the label for this route states no value; read from an HSDB sentence "
                                      f"on the compound's PubChem record. {systemic_note}"), "hsdb"
    return None, None


# ------------------------------------------------------------------------------------------------ build
def build(fetcher, generated_utc):
    gaps = []

    def gap(drug, route, field, reason):
        gaps.append({"drug": drug, "route": route, "field": field, "reason": reason})

    who2fda, fda_vocab, p_who2fda, p_fda_vocab = load_route_vocab()
    admr_md, p_admr = load_admr_md({d["name"] for d in DRUGS})
    who_tab, who_url, _ = who_atc_table(fetcher)
    ddd_def, ddd_def_url, _ = who_ddd_definition(fetcher)

    # -------------------------------------------------------------- identity: CID, structure, ChEMBL id
    drugs, cid_urls = [], {}
    for spec in DRUGS:
        d = dict(spec)
        if d["cid"] is None:
            cid, url, _ = pubchem_cid(fetcher, d["name"])
            if cid is None:
                raise RuntimeError(f"PubChem could not resolve a CID for {d['name']}")
            d["cid"], d["cid_source"] = cid, url
        else:
            d["cid_source"] = "the user's source sheet (CID supplied with the drug set)"
        cid_urls[d["name"]] = d["cid_source"]
        drugs.append(d)
    props, props_url, props_entry = pubchem_props(fetcher, [d["cid"] for d in drugs])

    for d in drugs:
        p = props[d["cid"]]
        smiles = p.get("SMILES") or p.get("ConnectivitySMILES")
        d["pubchem"] = {"cid": d["cid"], "title": p.get("Title"), "smiles": smiles,
                        "connectivity_smiles": p.get("ConnectivitySMILES"),
                        "molecular_formula": p.get("MolecularFormula"),
                        "molecular_weight": p.get("MolecularWeight"), "inchikey": p.get("InChIKey"),
                        "iupac_name": p.get("IUPACName"), "source_url": props_url,
                        "retrieved_utc": props_entry["retrieved_utc"],
                        "source_name": "PubChem (NCBI/NLM), public domain"}
        if p.get("Title", "").lower() != d["name"]:
            d["pubchem"]["title_note"] = (f"PubChem titles CID {d['cid']} '{p.get('Title')}'; this dataset "
                                          f"uses the WHO ATC name '{d['name']}' for {d['atc']}.")
        desc = descriptors(smiles)
        if desc is None:
            raise RuntimeError(f"RDKit could not parse the PubChem SMILES for {d['name']}")
        d["descriptors"] = {k: rnd(v) for k, v in desc.items()}
        d["_desc"] = desc

        mol, mol_url, mol_entry = chembl_molecule(fetcher, d["name"])
        if mol is None:
            d["chembl"] = None
            gap(d["name"], "all", "chembl_molecule",
                f"ChEMBL has no molecule whose pref_name is '{d['name']}' ({mol_url})")
        else:
            mol = dict(mol)
            mol["source_url"] = mol_url
            mol["retrieved_utc"] = mol_entry["retrieved_utc"]
            mol["inchikey_matches_pubchem"] = (mol.get("inchikey") == p.get("InChIKey"))
            if not mol["inchikey_matches_pubchem"]:
                mol["inchikey_note"] = ("ChEMBL and PubChem standard InChIKeys differ (salt, isomer or "
                                        "parent/child record); activities are still taken from this "
                                        "ChEMBL record and its id is published so the choice is checkable.")
            d["chembl"] = mol

        # activity and toxicity record sets (fetched once per drug, filtered per row)
        d["_acts"] = {"invitro": [], "ed50": [], "tox": []}
        d["_act_urls"] = {}
        d["_act_utc"] = {}
        if d.get("chembl"):
            cid_ = d["chembl"]["molecule_chembl_id"]
            for key, params, purpose in (
                ("invitro", {"target_chembl_id": CHEMBL_TARGET, "molecule_chembl_id": cid_},
                 f"ChEMBL: in vitro potency of {d['name']} at {CHEMBL_TARGET} (human histamine H2 receptor)"),
                ("ed50", {"molecule_chembl_id": cid_, "standard_type": "ED50"},
                 f"ChEMBL: in vivo ED50 records for {d['name']}"),
                ("tox", {"molecule_chembl_id": cid_, "standard_type__in": TOX_TYPES},
                 f"ChEMBL: toxicity records ({TOX_TYPES}) for {d['name']}"),
            ):
                recs, url, entry = chembl_activities(fetcher, params, purpose)
                d["_acts"][key] = recs
                d["_act_urls"][key] = url
                d["_act_utc"][key] = entry["retrieved_utc"]

        # label availability and HSDB annotations
        facet, facet_url, facet_entry = openfda_route_facet(fetcher, d["name"])
        dm_total, dm_url, dm_entry = dailymed_count(fetcher, d["name"])
        d["labels"] = {"openfda_route_counts": facet, "openfda_route_facet_url": facet_url,
                       "openfda_retrieved_utc": facet_entry["retrieved_utc"],
                       "dailymed_spl_count": dm_total, "dailymed_url": dm_url,
                       "dailymed_retrieved_utc": dm_entry["retrieved_utc"]}
        if not facet:
            d["labels"]["note"] = (f"No US label: openFDA returned no route facet for '{d['name']}' and "
                                   f"DailyMed reports {dm_total} SPLs. Routes come from the WHO ATC/DDD "
                                   "index only, and no label-derived value is available for this drug.")
        items, urls, utcs = [], {}, {}
        for heading in HSDB_HEADINGS:
            got, url, entry = pubchem_annotations(fetcher, d["cid"], heading)
            items += got
            urls[heading] = url
            utcs[heading] = entry["retrieved_utc"]
        d["_hsdb"] = {"items": items, "urls": urls, "retrieved": utcs}
        d["hsdb"] = {"n_sentences": len(items), "headings": HSDB_HEADINGS,
                     "urls": [urls[h] for h in HSDB_HEADINGS],
                     "note": ("PubChem annotations from excluded sources are not read: "
                              + "; ".join(f"{k} ({v})" for k, v in sorted(EXCLUDED_ANNOTATION_SOURCES.items())))}

        # ---------------------------------------------------------------------------------- routes
        who_row = who_tab.get(d["atc"])
        if not who_row:
            raise RuntimeError(f"{d['atc']} is not in the WHO ATC/DDD index page {who_url}")
        d["who"] = {"atc": d["atc"], "name": who_row["name"], "source_url": who_url,
                    "ddd_rows": who_row["ddd"]}
        routes = []
        for rec in who_row["ddd"]:
            code = rec["admr"]
            mapped = who2fda.get(code)
            if not mapped:
                gap(d["name"], code, "route_mapping",
                    f"WHO Adm.R '{code}' is not in {os.path.basename(p_who2fda)}")
                continue
            fda_route, refine_note = mapped["fda_route"], None
            if fda_route == "PARENTERAL":
                inj = sorted(r for r in facet if r in ("INTRAVENOUS", "INTRAMUSCULAR", "SUBCUTANEOUS"))
                if len(inj) == 1:
                    refine_note = (f"WHO '{code}' maps to the coarse FDA PARENTERAL; refined to {inj[0]} "
                                   f"because the drug's own US labels use exactly that route "
                                   f"({facet[inj[0]]} label(s), {facet_url}).")
                    fda_route = inj[0]
                elif len(inj) > 1:
                    refine_note = (f"Left coarse: the drug's US labels use {', '.join(inj)}, so no single "
                                   f"injection route can be chosen ({facet_url}).")
                else:
                    refine_note = (f"Left coarse: no current US parenteral label for this drug (openFDA route "
                                   f"facet lists {', '.join(sorted(facet)) or 'nothing'}; DailyMed reports "
                                   f"{dm_total} SPLs in total), so WHO '{code}' cannot be refined from labels.")
            voc = fda_vocab.get(fda_route)
            if not voc:
                gap(d["name"], fda_route, "route_vocabulary",
                    f"'{fda_route}' is not in {os.path.basename(p_fda_vocab)}")
                continue
            md = admr_md.get(d["name"])
            cross = None
            if md:
                cross = ("agrees with the WHO AdmR table in the sibling repo "
                         f"(mode_of_administration.md: {', '.join(md['admr'])})") if code in md["admr"] else \
                        ("DISAGREES with mode_of_administration.md, which lists "
                         f"{', '.join(md['admr'])} for this drug")
            else:
                cross = "not in mode_of_administration.md (that table covers only the three sheet drugs)"
            routes.append({"who_admr": code, "fda_route": fda_route, "fda_code": voc["fda_code"],
                           "nci_concept_id": voc["nci_concept_id"], "fda_short_name": voc["short_name"],
                           "fda_definition": voc["definition"], "who_to_fda_confidence": mapped["confidence"],
                           "who_to_fda_note": mapped["note"], "refinement": refine_note,
                           "cross_check": cross, "who_source_url": who_url,
                           "vocabulary_source": f"{os.path.basename(p_who2fda)} and {os.path.basename(p_fda_vocab)} "
                                                "(FDA/NCI SPL route of administration vocabulary)",
                           "_ddd": rec})
        d["routes"] = [{k: v for k, v in r.items() if not k.startswith("_")} for r in routes]
        d["_routes"] = routes
    return drugs, gaps, {"who_url": who_url, "ddd_def": ddd_def, "ddd_def_url": ddd_def_url,
                         "p_who2fda": p_who2fda, "p_fda_vocab": p_fda_vocab, "p_admr": p_admr,
                         "props_url": props_url}


# ---------------------------------------------------------------------------- in vivo activity/toxicity
PARENTERAL_LIKE = {"PARENTERAL", "INTRAVENOUS", "INTRAMUSCULAR", "SUBCUTANEOUS"}


def label_ld50(labels):
    """Lethal doses from the first label section that states any, with that label and section attached."""
    for lab in labels:
        for sec in LABEL_SECTIONS_TOX:
            txt = lab["sections"].get(sec)
            if not txt:
                continue
            recs = extract_ld50(txt)
            if recs:
                return recs, lab, sec
    return [], None, None


def _tox_candidates(drug, accepts, labels):
    out = []
    recs, lab, sec = label_ld50(labels)
    for r in recs:
        if r["route"] not in accepts:
            continue
        out.append({"species": r["species"], "unit": r["unit"], "relation": r["relation"],
                    "value": r["value"], "exp_route": r["route"], "kind": "label",
                    "sort": (0 if r["relation"] == "=" else 1, r["species"] or "", r["value"]),
                    "make": (lambda r=r, lab=lab, sec=sec: val(
                        r["value"], r["unit"], lab["query_url"], r["quote"], lab["retrieved_utc"],
                        relation=r["relation"], source_name="openFDA drug label API (FDA), public domain",
                        basis=(f"in vivo {r['endpoint']}, {r['route']} route, "
                               f"species {r['species']}, read from the label's {sec} section; matched to "
                               f"this row's route" + (", a lower bound ('not lethal')" if r["relation"] == ">" else "")),
                        extra={"endpoint": r["endpoint"], "species": r["species"],
                               "experimental_route": r["route"], "context": "in vivo",
                               "spl_set_id": lab["set_id"], "label_url": lab["label_url"],
                               "label_section": sec}))})
    for rec in drug["_acts"]["tox"]:
        if not usable(rec) or rec.get("standard_units") != "mg.kg-1":
            continue
        er = route_of(rec.get("assay_description"))
        if er not in accepts:
            continue
        sp = species_of(rec.get("assay_description"))
        out.append({"species": sp, "unit": "mg/kg", "relation": rec.get("standard_relation") or "=",
                    "value": float(rec["standard_value"]), "exp_route": er, "kind": "chembl", "rec": rec,
                    "sort": (0 if (rec.get("standard_relation") or "=") == "=" else 1, sp or "",
                             float(rec["standard_value"])),
                    "make": (lambda rec=rec, er=er, sp=sp, drug=drug: act_record(
                        rec, drug["_act_urls"]["tox"], drug["_act_utc"]["tox"], context="in vivo",
                        route_match=er, species=sp,
                        basis=f"in vivo {rec.get('standard_type')} from ChEMBL, {er} route, species {sp}; "
                              "matched to this row's route"))})
    return out


def _act_candidates(drug, accepts):
    out = []
    for rec in drug["_acts"]["ed50"]:
        if not usable(rec) or rec.get("standard_units") != "mg.kg-1":
            continue
        er = route_of(rec.get("assay_description"))
        if er not in accepts:
            continue
        sp = species_of(rec.get("assay_description"))
        out.append({"species": sp, "unit": "mg/kg", "relation": rec.get("standard_relation") or "=",
                    "value": float(rec["standard_value"]), "exp_route": er, "rec": rec})
    return out


def invivo_pair(drug, route, labels):
    """(toxicity_invivo, activity_invivo, notes). Species is chosen jointly so a therapeutic index is
    possible: the same species, the same units and this row's own route for both terms."""
    accepts = ROUTE_ACCEPTS.get(route["fda_route"], set())
    tox_c, act_c = _tox_candidates(drug, accepts, labels), _act_candidates(drug, accepts)
    notes = []
    tox_by, act_by = OrderedDict(), OrderedDict()
    for c in sorted(tox_c, key=lambda c: c["sort"]):
        tox_by.setdefault((c["species"], c["unit"]), []).append(c)
    for c in sorted(act_c, key=lambda c: (c["species"] or "", sort_key(c["rec"]))):
        act_by.setdefault((c["species"], c["unit"]), []).append(c)
    shared = sorted(set(tox_by) & set(act_by),
                    key=lambda k: (0 if any(c["relation"] == "=" for c in tox_by[k]) else 1, str(k[0])))
    tox_key = shared[0] if shared else (sorted(tox_by, key=lambda k: (tox_by[k][0]["sort"]))[0] if tox_by else None)
    act_key = shared[0] if shared else (sorted(act_by, key=lambda k: (-len(act_by[k]), str(k[0])))[0] if act_by else None)
    if shared:
        notes.append(f"species {shared[0][0]} and units {shared[0][1]} chosen because both the in vivo "
                     "toxicity and the in vivo activity for this row's route are available in them")
    elif tox_by and act_by:
        notes.append(f"no species has both terms for this route: toxicity in {sorted(str(k[0]) for k in tox_by)}, "
                     f"activity in {sorted(str(k[0]) for k in act_by)}; the two fields are not a matched pair")
    tox = tox_by[tox_key][0]["make"]() if tox_key else None
    act = None
    if act_key:
        group = act_by[act_key]
        picks = pick_orthogonal([c["rec"] for c in group])
        er = next(c["exp_route"] for c in group if c["rec"] is picks[0])
        act = act_record(picks[0], drug["_act_urls"]["ed50"], drug["_act_utc"]["ed50"], context="in vivo",
                         route_match=er, species=act_key[0],
                         basis=f"in vivo ED50 from ChEMBL, {er} route, species {act_key[0]}, matched to this "
                               f"row's route ({route['fda_route']}); "
                               + (f"{len(group)} route- and species-matched ED50 record(s) exist, the newest "
                                  "document's record is published here"))
        vals = [c["value"] for c in group if c["value"] > 0]
        act["n_route_species_matched"] = len(group)
        act["geometric_mean"] = rnd(math.exp(sum(math.log(v) for v in vals) / len(vals))) if vals else None
        if len(picks) > 1:
            act["confirmed_by"] = {"assay_chembl_id": picks[1].get("assay_chembl_id"),
                                   "document_chembl_id": picks[1].get("document_chembl_id"),
                                   "standard_type": picks[1].get("standard_type"),
                                   "value": rnd(float(picks[1]["standard_value"])),
                                   "unit": "mg/kg", "orthogonal": True}
        else:
            act["orthogonal"] = False
            act["orthogonal_note"] = ("only one independent assay/document for this route and species; "
                                      "merge.py's two-assay rule is not satisfied")
    if tox is not None and len(tox_by[tox_key]) > 1:
        tox["also_reported"] = [{"value": rnd(c["value"]), "unit": c["unit"], "relation": c["relation"],
                                 "species": c["species"]} for c in tox_by[tox_key][1:]]
    return tox, act, notes


def invitro_activity(drug):
    """Potency at CHEMBL1941: Ki first, then IC50, nM only, orthogonal confirmation where ChEMBL has it."""
    recs = [r for r in drug["_acts"]["invitro"] if usable(r) and r.get("standard_units") == "nM"]
    for stype in ("Ki", "IC50", "Kd", "AC50"):
        group = [r for r in recs if (r.get("standard_type") or "") == stype]
        if not group:
            continue
        picks = pick_orthogonal(group)
        rec = act_record(picks[0], drug["_act_urls"]["invitro"], drug["_act_utc"]["invitro"],
                         context="in vitro",
                         basis=f"in vitro {stype} at {CHEMBL_TARGET} (human histamine H2 receptor), the "
                               f"newest document's record of {len(group)} usable {stype} record(s); route "
                               "independent, so both of a drug's rows carry the same value")
        if len(picks) > 1:
            rec["confirmed_by"] = {"assay_chembl_id": picks[1].get("assay_chembl_id"),
                                   "document_chembl_id": picks[1].get("document_chembl_id"),
                                   "standard_type": picks[1].get("standard_type"),
                                   "value": rnd(float(picks[1]["standard_value"])), "unit": "nM",
                                   "orthogonal": True}
        else:
            rec["orthogonal"] = False
            rec["orthogonal_note"] = ("only one independent assay/document in ChEMBL for this compound at "
                                      f"{CHEMBL_TARGET}; merge.py's two-assay rule is not satisfied")
        rec["n_usable_records"] = len(group)
        return rec, stype
    return None, None


def invitro_toxicity(drug):
    recs = [r for r in drug["_acts"]["tox"] if usable(r)
            and (r.get("standard_type") or "").upper() in ("CC50", "TC50")]
    if not recs:
        return None
    picks = pick_orthogonal(recs)
    return act_record(picks[0], drug["_act_urls"]["tox"], drug["_act_utc"]["tox"], context="in vitro",
                      basis="in vitro cytotoxicity from ChEMBL; never mixed with the in vivo toxicity field")


# ------------------------------------------------------------------------------------------- the rows
ROW_FIELDS = ["F", "t_half_h", "dose_mg", "tau_h", "vd_L", "fraction_unbound", "activity_invitro",
              "activity_invivo", "toxicity_invitro", "toxicity_invivo", "who_ddd_mg"]


def make_rows(fetcher, drugs, gap, ddd_def):
    rows = []
    for d in drugs:
        for route in d["_routes"]:
            fda = route["fda_route"]
            name, rname = d["name"], fda
            labels, label_urls = openfda_labels(fetcher, name, fda)
            lab_ev = {"openfda_queries": label_urls, "n_labels": len(labels),
                      "labels_used": [{"set_id": l["set_id"], "effective_time": l["effective_time"],
                                       "label_url": l["label_url"]} for l in labels[:5]]}
            if not labels:
                lab_ev["note"] = (f"openFDA has no label for {name} with route {fda} "
                                  f"(queries: {'; '.join(label_urls)}; route facet: "
                                  f"{d['labels']['openfda_route_facet_url']} -> "
                                  f"{json.dumps(d['labels']['openfda_route_counts'], sort_keys=True)}; "
                                  f"DailyMed: {d['labels']['dailymed_url']} -> "
                                  f"{d['labels']['dailymed_spl_count']} SPLs).")
            no_label = f"no US label for {name} with route {fda}; see label_evidence.note"
            systemic = ("Half-life, volume of distribution and unbound fraction are systemic parameters; "
                        "this sentence is not route-specific, so it is used for every route of the drug.")
            row = {"drug": name, "atc": d["atc"], "cid": d["cid"], "drug_source": d["source"],
                   "route": {k: v for k, v in route.items() if not k.startswith("_")},
                   "label_evidence": lab_ev, "descriptors": d["descriptors"], "notes": []}

            # ---- F
            if fda in ("PARENTERAL", "INTRAVENOUS"):
                extra_note = ("" if fda == "INTRAVENOUS" else
                              " This row's route is the coarse FDA PARENTERAL, which also covers "
                              "intramuscular and subcutaneous administration, where F = 1 does not "
                              "strictly hold; the WHO Adm.R code is 'P' and could not be refined further.")
                row["F"] = val(1.0, "fraction of dose", None,
                               "FDA route definition: " + route["fda_definition"], None, relation="=",
                               source_name="definition, not a measurement",
                               basis="IV, by definition" + extra_note,
                               extra={"is_definition": True})
                row["F_basis"] = "IV, by definition" + extra_note
            else:
                rec, origin = pk_field(labels, d["_hsdb"], extract_F, route_label=fda,
                                       systemic_note="Bioavailability here is the oral fraction absorbed.")
                row["F"] = rec
                if rec is None:
                    reason = (no_label if not labels else
                              f"the {fda} label(s) state no bioavailability or fraction absorbed") + \
                             "; no HSDB sentence on the compound's PubChem record states one either"
                    row["F_basis"] = "Not sourced. " + reason
                    gap(name, fda, "F", reason)
                else:
                    row["F_basis"] = rec["basis"]

            # ---- half-life, Vd, unbound fraction
            for field, extractor, label in (("t_half_h", extract_t_half, "elimination half-life"),
                                            ("vd_L", extract_vd, "volume of distribution"),
                                            ("fraction_unbound", extract_fu, "unbound fraction")):
                rec, origin = pk_field(labels, d["_hsdb"], extractor, route_label=fda, systemic_note=systemic)
                row[field] = rec
                if rec is None:
                    gap(name, fda, field,
                        (no_label if not labels else f"the {fda} label(s) state no {label}")
                        + "; no HSDB sentence on the compound's PubChem record states one either")
            if row["fraction_unbound"] is not None:
                pb = row["fraction_unbound"].pop("pb_percent", None)
                row["fraction_unbound"]["basis"] = (
                    "fraction_unbound = 1 - plasma protein binding read from the quoted sentence"
                    + (f" (binding {pb:g}%)" if pb is not None else "")
                    + ". " + (row["fraction_unbound"].get("basis") or ""))
            for f in ("F", "t_half_h", "vd_L"):
                if row[f] is not None:
                    row[f].pop("pb_percent", None)

            # ---- dose and interval
            hit, lab, sec = from_labels(labels, LABEL_SECTIONS_DOSE, extract_regimen)
            if hit:
                base = (f"first explicit 'N mg <frequency>' adult regimen in the {fda} label's "
                        f"{sec} section" + (" (sentences mentioning 'recommended' are read first)"
                                            if hit["preferred"] else ""))
                row["dose_mg"] = val(hit["dose"], "mg", lab["query_url"], hit["quote"], lab["retrieved_utc"],
                                     source_name="openFDA drug label API (FDA), public domain", basis=base,
                                     extra={"spl_set_id": lab["set_id"], "label_url": lab["label_url"],
                                            "label_section": sec})
                row["tau_h"] = val(hit["tau"], "h", lab["query_url"], hit["quote"], lab["retrieved_utc"],
                                   source_name="openFDA drug label API (FDA), public domain",
                                   basis=base + "; " + hit["tau_basis"],
                                   extra={"spl_set_id": lab["set_id"], "label_url": lab["label_url"],
                                          "label_section": sec})
            else:
                row["dose_mg"] = row["tau_h"] = None
                reason = (no_label if not labels else
                          f"the {fda} label(s) state no adult regimen as an explicit 'N mg <frequency>'")
                gap(name, fda, "dose_mg", reason)
                gap(name, fda, "tau_h", reason)

            # ---- WHO DDD (a unit of measurement, never used as the dose)
            ddd = route["_ddd"]
            if ddd["ddd"] is not None:
                mg = ddd["ddd"] * (1000.0 if ddd["unit"] == "g" else 1.0)
                row["who_ddd_mg"] = val(mg, "mg per day", route["who_source_url"], ddd["row_text"], None,
                                        source_name="WHO ATC/DDD Index (WHOCC)",
                                        basis=f"DDD {ddd['ddd']:g} {ddd['unit']} for Adm.R '{ddd['admr']}', "
                                              f"converted to mg (1 g = 1000 mg). WHO: \"{ddd_def}\" The DDD "
                                              "is therefore published as a unit of measurement and is NOT "
                                              "used as dose_mg anywhere in this dataset.",
                                        extra={"who_admr": ddd["admr"], "ddd_raw": ddd["ddd"],
                                               "ddd_unit": ddd["unit"], "is_unit_of_measurement": True})
            else:
                row["who_ddd_mg"] = None
                gap(name, fda, "who_ddd_mg", f"the WHO ATC/DDD index gives no DDD for {d['atc']} Adm.R "
                                             f"'{ddd['admr']}' ({route['who_source_url']})")

            # ---- activity and toxicity
            act_iv, stype = invitro_activity(d)
            row["activity_invitro"] = act_iv
            if act_iv is None:
                gap(name, fda, "activity_invitro",
                    (f"ChEMBL has no usable Ki/IC50/Kd/AC50 in nM for this compound at {CHEMBL_TARGET} "
                     f"({d['_act_urls'].get('invitro', 'no ChEMBL molecule record')})") if d.get("chembl")
                    else f"no ChEMBL molecule record for {name}, so no activity at {CHEMBL_TARGET}")
            tox_vv, act_vv, pair_notes = invivo_pair(d, route, labels)
            row["activity_invivo"], row["toxicity_invivo"] = act_vv, tox_vv
            row["notes"] += pair_notes
            if act_vv is None:
                gap(name, fda, "activity_invivo",
                    f"ChEMBL has no in vivo ED50 in mg/kg whose assay description states a route this row's "
                    f"{fda} route accepts ({', '.join(sorted(ROUTE_ACCEPTS.get(fda, set()))) or 'none'}); "
                    f"queried {d['_act_urls'].get('ed50', 'no ChEMBL molecule record')}")
            if tox_vv is None:
                gap(name, fda, "toxicity_invivo",
                    "no route-matched in vivo lethal dose: the label sections "
                    + ", ".join(LABEL_SECTIONS_TOX) + " state none for this route"
                    + (f" ({no_label})" if not labels else "")
                    + f", and ChEMBL has no {TOX_TYPES} record in mg/kg for a route this row accepts "
                      f"({d['_act_urls'].get('tox', 'no ChEMBL molecule record')})")
            row["toxicity_invitro"] = invitro_toxicity(d)
            if row["toxicity_invitro"] is None:
                gap(name, fda, "toxicity_invitro",
                    f"ChEMBL has no CC50/TC50 record for this compound "
                    f"({d['_act_urls'].get('tox', 'no ChEMBL molecule record')}); in vitro cytotoxicity is "
                    "never substituted by an in vivo value")

            # ---- derived: therapeutic index
            ti_val, ti_rel = None, None
            if tox_vv is not None and act_vv is not None:
                ti_rel = combine_relation([tox_vv, act_vv])
                if ti_rel is not None:
                    ti_val = rnd(therapeutic_index(tox_vv["value"], act_vv["value"]), 4)
            row["therapeutic_index"] = None if ti_val is None else {
                "value": ti_val, "relation": ti_rel, "unit": "log10 of (mg/kg x mg/kg)",
                "formula": TI_FORMULA,
                "inputs": {"toxicity_invivo": tox_vv["value"], "activity_invivo": act_vv["value"],
                           "unit": tox_vv["unit"], "species": tox_vv.get("species"),
                           "route": route["fda_route"]}}
            row["ti_basis"] = ti_basis_text(tox_vv if ti_val is not None else None,
                                            act_vv if ti_val is not None else None, ti_val)
            if ti_val is None:
                why = ("the toxicity and activity bounds point in opposite directions, so no bound can be "
                       "stated" if (tox_vv and act_vv) else
                       "activity_invivo and/or toxicity_invivo are null for this row (see their own gaps)")
                gap(name, fda, "therapeutic_index", why)
            std = None
            if ti_val is not None and act_vv["value"] > 0:
                flip = {"=": "=", "~": "~", ">": "<", "<": ">"}[act_vv["relation"]]
                srel = combine_relation([tox_vv, {"relation": flip}])
                if srel is not None:
                    std = {"value": rnd(math.log10(tox_vv["value"] / act_vv["value"]), 4), "relation": srel,
                           "unit": "log10 ratio, dimensionless",
                           "formula": "log10(toxicity_invivo / activity_invivo)",
                           "basis": "the standard log10(TD50/ED50) for the same route-, species- and "
                                    "unit-matched pair, emitted beside the brief's expression so the two "
                                    "readings can be compared; it is NOT a correction applied to "
                                    "therapeutic_index."}
            row["therapeutic_index_standard"] = std

            # ---- derived: free_conc and the honest concentration
            terms = {"F": row["F"], "t_half_h": row["t_half_h"], "dose_mg": row["dose_mg"],
                     "tau_h": row["tau_h"]}
            tvals = {k: (v["value"] if v else None) for k, v in terms.items()}
            fc_val, fc_rel = None, None
            if all(v is not None for v in terms.values()):
                fc_rel = combine_relation(list(terms.values()))
                if fc_rel is not None:
                    fc_val = rnd(free_conc(**tvals), 4)
            unit_note = ""
            css_mg_l, css_norm = None, None
            if fc_val is not None and row["fraction_unbound"] is not None and row["vd_L"] is not None:
                vd, fu = row["vd_L"], row["fraction_unbound"]
                rel = combine_relation([{"relation": fc_rel}, fu,
                                        {"relation": {"=": "=", "~": "~", ">": "<", "<": ">"}[vd["relation"]]}])
                base = fc_val * fu["value"] / vd["value"]
                common = {"relation": rel, "formula": "free_conc * fraction_unbound / vd",
                          "inputs": {"free_conc": fc_val, "fraction_unbound": fu["value"],
                                     "vd": vd["value"], "vd_unit": vd["unit"]}}
                if vd["unit"] == "L":
                    css_mg_l = dict(common, value=rnd(base, 6), unit="mg/L",
                                    basis="average free (unbound) steady-state concentration, computed "
                                          "properly: the exposure proxy divided by the volume of "
                                          "distribution in litres and multiplied by the unbound fraction.")
                else:
                    css_norm = dict(common, value=rnd(base, 6), unit="mg*kg/L",
                                    basis="the volume of distribution is published in L/kg, and no fetched "
                                          "source gives a body weight, so this is the weight-normalised "
                                          "free steady-state concentration: DIVIDE it by the patient's body "
                                          "weight in kg to get mg/L. No body weight is assumed anywhere.")
                    unit_note = ("css_free_weight_normalised holds the properly computed free concentration "
                                 "per kg of body weight (mg*kg/L); css_free_mg_L stays null because the "
                                 "volume of distribution is only published in L/kg and inventing a body "
                                 "weight is not allowed.")
            elif fc_val is not None:
                unit_note = ("css_free_mg_L is null: " + ", ".join(
                    n for n, v in (("vd_L", row["vd_L"]), ("fraction_unbound", row["fraction_unbound"]))
                    if v is None) + " could not be sourced for this row.")
            row["free_conc"] = None if fc_val is None else {
                "value": fc_val, "relation": fc_rel, "unit": "mg (average amount in the body at steady state)",
                "formula": FC_FORMULA, "inputs": {k: rnd(v) for k, v in tvals.items()}}
            row["free_conc_basis"] = fc_basis_text(terms, fc_val, unit_note)
            row["css_free_mg_L"] = css_mg_l
            row["css_free_weight_normalised"] = css_norm
            row["css_free_basis"] = (css_mg_l or css_norm or {}).get("basis") or (
                "Not computed. " + (unit_note or "free_conc is null for this row, so no concentration can "
                                    "be derived from it."))
            if fc_val is None:
                gap(name, fda, "free_conc",
                    "missing input(s): " + ", ".join(k for k, v in terms.items() if v is None)
                    + " (see their own gaps)" if any(v is None for v in terms.values())
                    else "the input bounds point in opposite directions, so no bound can be stated")
            if css_mg_l is None:
                gap(name, fda, "css_free_mg_L", unit_note or
                    "free_conc, vd_L or fraction_unbound is null for this row")
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------------------------- output
def dump_json(obj):
    """Deterministic bytes: sorted keys, no spaces, UTF-8, trailing newline."""
    return (json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


PROV_COLUMNS = ["drug", "atc", "route_fda", "route_who", "field", "value", "relation", "unit", "species",
                "context", "source_name", "source_licence", "source_url", "retrieved_utc",
                "assay_chembl_id", "document_chembl_id", "spl_set_id", "quote"]


def provenance_rows(rows):
    """One row per sourced value: what it is, where it came from and the sentence it was read from."""
    out = []
    for r in rows:
        for field in ROW_FIELDS:
            rec = r.get(field)
            if not rec:
                continue
            host = urllib.parse.urlsplit(rec.get("source_url") or "").netloc
            lic = LICENCES.get(host, (None, "not applicable (definition, not a fetched value)"))[1]
            out.append({"drug": r["drug"], "atc": r["atc"], "route_fda": r["route"]["fda_route"],
                        "route_who": r["route"]["who_admr"], "field": field, "value": rec.get("value"),
                        "relation": rec.get("relation"), "unit": rec.get("unit"),
                        "species": rec.get("species") or "", "context": rec.get("context") or "",
                        "source_name": rec.get("source_name") or "", "source_licence": lic,
                        "source_url": rec.get("source_url") or "",
                        "retrieved_utc": rec.get("retrieved_utc") or "",
                        "assay_chembl_id": rec.get("assay_chembl_id") or "",
                        "document_chembl_id": rec.get("document_chembl_id") or "",
                        "spl_set_id": rec.get("spl_set_id") or "", "quote": rec.get("quote") or ""})
    out.sort(key=lambda r: (r["drug"], r["route_fda"], r["field"]))
    return out


def dump_csv(prov):
    buf = io.StringIO(newline="")
    w = csv.DictWriter(buf, fieldnames=PROV_COLUMNS, lineterminator="\n", extrasaction="raise")
    w.writeheader()
    for row in prov:
        w.writerow(row)
    return buf.getvalue().encode("utf-8")


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT, help="output folder (default site/receptor/data)")
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="response cache (default .h2_cache, gitignored)")
    ap.add_argument("--generated-utc", default=os.environ.get("H2_GENERATED_UTC"),
                    help="pin meta.generated_utc so a rerun reproduces the bytes")
    ap.add_argument("--check", action="store_true",
                    help="write nothing; rebuild from the cache (no network) and exit 1 unless the files on "
                         "disk are byte-identical")
    a = ap.parse_args(argv)
    h2_path = os.path.join(a.out, "h2.json")
    prov_path = os.path.join(a.out, "h2_provenance.csv")

    generated = a.generated_utc
    if a.check:
        _selftest()
        try:
            with open(h2_path, encoding="utf-8") as f:
                generated = json.load(f)["meta"]["generated_utc"]
        except (OSError, ValueError, KeyError) as e:
            print(f"curate_h2: --check needs a readable {h2_path}: {e}", file=sys.stderr)
            return 1
    generated = generated or _utc_now()

    fetcher = Fetcher(a.cache, offline=a.check)
    try:
        drugs, gaps, ctx = build(fetcher, generated)
        rows = make_rows(fetcher, drugs, lambda *x: gaps.append(
            {"drug": x[0], "route": x[1], "field": x[2], "reason": x[3]}), ctx["ddd_def"])
    except RuntimeError as e:
        print(f"curate_h2: {e}", file=sys.stderr)
        return 2
    route_means = box_jenkins(rows)
    gaps.sort(key=lambda g: (g["drug"], g["route"], g["field"]))

    sources = [
        {"name": "WHO ATC/DDD Index", "url": ctx["who_url"], "licence": LICENCES["atcddd.fhi.no"][1],
         "role": "ATC codes, routes of administration (Adm.R) and DDDs for the A02BA class"},
        {"name": "WHO DDD definition", "url": ctx["ddd_def_url"], "licence": LICENCES["atcddd.fhi.no"][1],
         "role": "the definition that keeps the DDD out of dose_mg", "quote": ctx["ddd_def"]},
        {"name": "PubChem PUG REST", "url": ctx["props_url"],
         "licence": LICENCES["pubchem.ncbi.nlm.nih.gov"][1],
         "role": "CID resolution, SMILES, formula, InChIKey (the structures the descriptors come from)"},
        {"name": "PubChem PUG-View (HSDB annotations)", "url": PUGVIEW,
         "licence": "HSDB records are US Government work, public domain",
         "role": "pharmacokinetic sentences where the FDA label is silent"},
        {"name": "openFDA drug label API", "url": FDA_LABEL, "licence": LICENCES["api.fda.gov"][1],
         "role": "bioavailability, half-life, regimen, Vd, protein binding, animal lethal doses"},
        {"name": "DailyMed SPL service", "url": DAILYMED, "licence": LICENCES["dailymed.nlm.nih.gov"][1],
         "role": "evidence of how many US labels exist for each drug (0 is evidence too)"},
        {"name": "ChEMBL REST API", "url": CHEMBL, "licence": LICENCES["www.ebi.ac.uk"][1],
         "role": f"in vitro potency at {CHEMBL_TARGET}, in vivo ED50, toxicity records"},
        {"name": "WHO -> FDA route map and FDA/NCI route vocabulary",
         "url": "local: " + os.path.relpath(ctx["p_who2fda"]) + ", " + os.path.relpath(ctx["p_fda_vocab"]),
         "licence": "input files of the sibling curation repo (FDA/NCI SPL vocabulary)",
         "role": "WHO Adm.R -> FDA route, FDA route code and NCI concept id"},
        {"name": "WHO AdmR table (sibling repo)", "url": "local: " + os.path.relpath(ctx["p_admr"]),
         "licence": "input file of the sibling curation repo",
         "role": "cross-check of the routes for the three drugs in the user's source sheet"},
    ]
    filled = {f: sum(1 for r in rows if r.get(f)) for f in ROW_FIELDS}
    filled.update({f: sum(1 for r in rows if r.get(f)) for f in
                   ("therapeutic_index", "therapeutic_index_standard", "free_conc", "css_free_mg_L",
                    "css_free_weight_normalised")})
    import platform
    from rdkit import rdBase
    out = {
        "meta": {
            "generated_utc": generated,
            "dataset": ("H2-receptor antagonists, the full WHO ATC A02BA class, one row per drug x route "
                        "of administration"),
            "chembl_target": CHEMBL_TARGET,
            "chembl_target_name": "Histamine H2 receptor (Homo sapiens)",
            "rdkit_version": rdBase.rdkitVersion,
            "python_version": platform.python_version(),
            "method_citation": METHOD_CITATION,
            "generator": "tools/curate_h2.py",
            "formulas": {"therapeutic_index": TI_FORMULA, "free_conc": FC_FORMULA,
                         "therapeutic_index_standard": "log10(toxicity_invivo / activity_invivo)",
                         "css_free": "free_conc * fraction_unbound / vd"},
            "descriptor_definitions": DESC_DOC,
            "rules": [
                "No experimental number is invented, estimated or recalled from memory: every value carries "
                "the URL it was read from, the sentence it was read from and that URL's retrieval time.",
                "A value no fetched source states is null and is listed in gaps[] with the reason.",
                "A range in the source becomes the midpoint with relation '~' and the range is kept; "
                "'exceeds 70%' becomes relation '>' and the derived columns propagate the bound.",
                "In vitro values are never mixed with in vivo values, and an in vivo toxicity or activity "
                "is only attached to a row whose own route the experiment used.",
                "Orthogonal confirmation follows the sibling repo's merge.py: a second record from a "
                "different ChEMBL assay AND a different document; rows where ChEMBL has only one are "
                "flagged orthogonal=false.",
                "The WHO DDD is published as a unit of measurement and is never used as dose_mg.",
            ],
            "excluded_annotation_sources": EXCLUDED_ANNOTATION_SOURCES,
            "sources": sources,
            "requests": [fetcher.log[u] for u in sorted(fetcher.log)],
            "counts": {"n_drugs": len(drugs), "n_rows": len(rows), "n_gaps": len(gaps),
                       "n_requests": len(fetcher.log), "filled_rows_per_field": filled},
        },
        "drugs": [{k: v for k, v in d.items() if not k.startswith("_")} for d in drugs],
        "rows": rows,
        "route_means": route_means,
        "gaps": gaps,
    }
    h2_bytes, prov_bytes = dump_json(out), dump_csv(provenance_rows(rows))
    if a.check:
        bad = []
        for path, data in ((h2_path, h2_bytes), (prov_path, prov_bytes)):
            try:
                with open(path, "rb") as f:
                    same = f.read() == data
            except OSError:
                same = False
            if not same:
                bad.append(os.path.relpath(path, ROOT))
        if bad:
            print(f"curate_h2: --check failed, not byte-identical: {', '.join(bad)}", file=sys.stderr)
            return 1
        print(f"curate_h2: --check ok ({len(rows)} rows, {len(gaps)} gaps, {len(fetcher.log)} cached "
              f"requests, both files byte-identical)")
        return 0
    write_atomic(h2_path, h2_bytes)
    write_atomic(prov_path, prov_bytes)
    print(f"curate_h2: {len(drugs)} drugs, {len(rows)} rows, {len(gaps)} gaps, {len(fetcher.log)} requests")
    print(f"  {os.path.relpath(h2_path, ROOT)}  {len(h2_bytes)} bytes")
    print(f"  {os.path.relpath(prov_path, ROOT)}  {len(prov_bytes)} bytes")
    for f in ROW_FIELDS:
        print(f"  filled {f:<18} {filled[f]}/{len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
