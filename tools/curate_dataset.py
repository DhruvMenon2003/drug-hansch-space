#!/usr/bin/env python3
"""Curate the Drug Bank workbook into one ML-ready long table: one row per (drug, ATC code, mode).

The workbook is almost entirely empty below its header: 759 drugs carry an ATC code and four ATC level
labels, and every descriptor, route, bioavailability, half-life, dose and toxicity cell is blank. This
script keeps everything the sheet does say, layers sourced values on top of it, and writes down where
each one came from. A sheet value is never overwritten: it is preserved in a ``sheet_*`` column beside
the computed one.

    python3 tools/curate_dataset.py --atc4 A02BA          # smoke test: the H2-receptor antagonists
    python3 tools/curate_dataset.py                       # the full dataset
    python3 tools/curate_dataset.py --offline             # cache and local files only, no network

THE MODE-OF-ADMINISTRATION RULE, as the user stated it
------------------------------------------------------
"IF the ATC/DDD AdmR column is filled, use that and map it to the FDA legend (closest match, your
judgement). IF the ATC/DDD AdmR column is empty, only then get it from the FDA label or DailyMed or
DrugBank or PubChem or some other resource; sometimes it is not applicable, but in the end it has to be
mapped to the FDA legend."

So the branches are tried strictly in this order, and the branch that filled a mode is recorded in
``mode_source`` and in the provenance file:

    atc_ddd_admr     the WHO ATC/DDD AdmR routes already curated per (CID, ATC code) in data/drugs.json
    openfda_route    openfda.route from a US drug label, local label cache first, then the live API
    dailymed_form    a dosage form read off a DailyMed SPL listing title -- an INFERENCE, not a label route
    not_applicable   nothing states a route, so the row is emitted as the legend's NOT APPLICABLE entry

Every mode ends up mapped to the FDA route legend, which is ground truth: a route is matched to the
legend by its NAME and then by its SHORT NAME, and is never re-mapped onto a route the legend treats as
different. INTRAOCULAR stays INTRAOCULAR; it is not folded into OPHTHALMIC. A drug whose route is
genuinely not applicable keeps its row, mapped to NOT APPLICABLE (SHORT NAME NA, FDA CODE 312,
NCI CONCEPT ID C48623), rather than being dropped.

THE SMILES RULE, as the user stated it
--------------------------------------
"Strictly use /mnt/project-files/drugbank_drugs_info.csv or RDKit utils for getting SMILES (there is an
inbuilt function to check for error in SMILES) or ChEMBL. Do NOT use PubChem for SMILES because the
SMILES there cannot distinguish tautomers or isomers."

PubChem is therefore never asked for a structure. The order is:

    sheet       the workbook's own SMILES cell, when it is not empty
    drugbank    moldb_smiles from drugbank_drugs_info.csv, matched on name, case-insensitive
    curated     the parent SMILES already in data/drugs.json for that CID (ChEMBL/dataset-derived)
    chembl      the ChEMBL web API, by name

Every candidate is parsed with ``Chem.MolFromSmiles(s, sanitize=True)`` BEFORE it is accepted, and a
candidate RDKit rejects falls through to the next source in that same order, with the rejection written
into ``smiles_source``. When a candidate fails it is re-parsed unsanitized and run through
``Chem.DetectChemistryProblems`` and ``Chem.SanitizeMol`` so the actual error text lands in
``smiles_error``. Only when every permitted source is rejected does the row keep the first candidate and
its diagnosis. ``smiles_ok`` says whether RDKit accepted the structure the row ended up with.

Drug names are matched onto each source by ``NameIndex``, which also crosses the INN/USAN spelling split
(aciclovir/acyclovir) and the base-vs-salt split (morphine/morphine sulfate); both are nomenclature
steps over one substance, and each one is named in the evidence string it returns.

OTHER RULES THIS SCRIPT KEEPS
-----------------------------
*   No number is ever invented or recalled. A cell is either sourced, in which case it carries a source
    and the sentence it was read out of, or it is empty and ``fill_note`` says why.
*   A lethal dose is meaningless without its kind and route, so ``tox_dose_kind``, ``tox_species`` and
    ``tox_route`` travel with every toxicity number, and a no-effect dose is never silently treated as
    an LD50 -- ``tox_use_in_ti`` marks whether the value belongs in a therapeutic index at all.
*   The formulas are the workbook's own:
        In Vivo Free Drug Concentration = 1.44 * F * half-life(h) * dose(mg) / dose interval(h)
        Therapeutic Index               = LOG10(in-vivo toxicity) - LOG10(1 / in-vivo activity)
    The Excel formula string is kept in ``free_conc_formula`` so the user's workbook still works, and the
    conventional log10(tox/act) is emitted beside the user's index as ``therapeutic_index_classical``.
*   Output is deterministic: rows are sorted, floats are rounded to a fixed number of places, and no
    timestamp appears inside a data row. Timestamps live in ``meta`` and in the provenance file.

OUTPUTS
-------
    data/clean_drugs.csv              the verbose long table, one row per (drug, ATC code, mode)
    site/data/clean_drugs.json        the same table compacted for the web explorer
    data/clean_provenance.csv         one row per sourced value: compound, field, value, url, quote, status
"""
import argparse
import csv
import datetime as dt
import glob
import gzip
import hashlib
import html
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
from collections import Counter, defaultdict

import pandas as pd
import requests
from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, QED, rdMolDescriptors

RDLogger.DisableLog("rdApp.*")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DEFAULT = "/mnt/project-files/Copy of Drug Bank Dataset.tsv.xlsx"
SHEET_WORK = "Drug Bank Dataset Copy"       # header row is the SECOND row; row one is a merged banner
SHEET_LEGEND = "Mode of Administration Legend"
FDA_ROUTES_TSV = os.path.join(HERE, "tools", "inputs", "fda_route_of_administration.tsv")
DRUGS_JSON = os.path.join(HERE, "data", "drugs.json")
PK_TABLE = os.path.join(HERE, "tools", "inputs", "{}_pk_tox.json")
DRUGBANK_CSV = "/mnt/project-files/drugbank_drugs_info.csv"
DAILYMED_DIR = "/mnt/project-files/DailyMed Data"
PRIOR_FEATURES = "/mnt/project-files/h2-run-2026-10-13/features.csv"
PRIOR_PKTOX = "/mnt/project-files/resource-deep-dive-2026-10-13/h2-pk-tox.json"

# tools/data/cache_*/ is already in this repo's .gitignore, so the cache never reaches a commit.
CACHE_DEFAULT = os.path.join(HERE, "tools", "data", "cache_curate")

WHO = "https://atcddd.fhi.no/atc_ddd_index/?code={}&showdescription=no"
CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
OPENFDA = "https://api.fda.gov/drug/label.json"
PKDB = "https://pk-db.com/api/v1"
UA = "drug-hansch-space dataset curation (research; github.com/DhruvMenon2003)"

QED_PROPS = ("MW", "ALOGP", "HBA", "HBD", "PSA", "ROTB", "AROM", "ALERTS")
BODY_KG = 70.0            # a WHO DDD is written for a 70 kg adult
DDD_INTERVAL_H = 24.0     # a DDD is one day's maintenance dose

# WHO ATC/DDD administration-route codes -> the FDA route legend's NAME column.
# "P" is the WHO code for parenteral, and PARENTERAL is itself a legend entry, so it maps straight
# across rather than being narrowed to INTRAVENOUS, which the legend treats as a different route.
WHO_ROUTE = {
    "O": "ORAL", "P": "PARENTERAL", "N": "NASAL", "R": "RECTAL", "SL": "SUBLINGUAL",
    "TD": "TRANSDERMAL", "V": "VAGINAL", "S.C": "SUBCUTANEOUS", "S.C.": "SUBCUTANEOUS",
    "IMPLANT": "IMPLANTATION", "INHAL": "RESPIRATORY (INHALATION)",
    "INHAL.AEROSOL": "RESPIRATORY (INHALATION)", "INHAL.POWDER": "RESPIRATORY (INHALATION)",
    "INHAL.SOLUTION": "RESPIRATORY (INHALATION)", "ORAL AEROSOL": "RESPIRATORY (INHALATION)",
    "CHEWING GUM": "ORAL", "OINTMENT": "TOPICAL", "URETHRAL": "URETHRAL",
    "LAMELLA": "OPHTHALMIC", "INSTILL.SOL": "OPHTHALMIC",
}
# The parenteral sub-routes the legend keeps separate. A WHO DDD given only for "P" is reported for
# these rows with the substitution spelled out in the quote, never silently.
PARENTERAL_KIN = ("INTRAVENOUS", "INTRAMUSCULAR", "SUBCUTANEOUS", "INTRA-ARTERIAL", "INTRAVASCULAR")
UNIT_MG = {"mg": 1.0, "g": 1000.0, "mcg": 0.001, "ug": 0.001, "µg": 0.001}

# Dosage forms that appear in DailyMed SPL listing titles, and the legend route each one implies.
# This is an inference from a dosage form, not a route the label states, and rows filled this way are
# marked mode_source=dailymed_form so the distinction survives into the output.
FORM_ROUTE = [
    ("OPHTHALMIC", "OPHTHALMIC"), ("EYE DROP", "OPHTHALMIC"), ("OTIC", "AURICULAR (OTIC)"),
    ("EAR DROP", "AURICULAR (OTIC)"), ("NASAL", "NASAL"), ("INHAL", "RESPIRATORY (INHALATION)"),
    ("TRANSDERMAL", "TRANSDERMAL"), ("PATCH", "TRANSDERMAL"), ("SUPPOSITORY", "RECTAL"),
    ("ENEMA", "RECTAL"), ("RECTAL", "RECTAL"), ("VAGINAL", "VAGINAL"), ("SUBLINGUAL", "SUBLINGUAL"),
    ("BUCCAL", "BUCCAL"), ("INJECTION", "PARENTERAL"), ("INJECTABLE", "PARENTERAL"),
    ("CREAM", "TOPICAL"), ("OINTMENT", "TOPICAL"), ("LOTION", "TOPICAL"), ("GEL", "TOPICAL"),
    ("SHAMPOO", "TOPICAL"), ("FOAM", "TOPICAL"), ("TOPICAL", "TOPICAL"), ("DENTAL", "DENTAL"),
    ("TABLET", "ORAL"), ("CAPSULE", "ORAL"), ("SUSPENSION", "ORAL"), ("SYRUP", "ORAL"),
    ("SOLUTION, ORAL", "ORAL"), ("ORAL", "ORAL"), ("GRANULE", "ORAL"), ("LOZENGE", "ORAL"),
]

SENT = re.compile(r"(?<!\d)\.(?=\s|$)")
NUM = r"(\d+(?:\.\d+)?)"
# A sentence about a special population is not the ordinary adult value.
SPECIAL = ("renal insufficien", "creatinine clearance", "impair", "pediatric", "paediatric", "neonat",
           "children", "cirrho", "hepatic", "elderly", "geriatric", "dialysis")
NEGATED = ("not lethal", "nonlethal", "non-lethal", "without effect", "no deaths", "no mortality",
           "dominant lethal", "no lethality", "were not", "was not")
LETHAL = r"(?:LD\s*50|LD\s*50s|median lethal dose|minimum lethal|lethal dose|lethal single|lethal oral)"
SPECIES = ("mouse", "mice", "rat", "rats", "dog", "dogs", "rabbit", "rabbits", "monkey", "monkeys",
           "guinea pig", "hamster", "human", "humans")
TOX_ROUTES = (("oral", "ORAL"), ("by mouth", "ORAL"), ("intravenous", "INTRAVENOUS"),
              ("i.v.", "INTRAVENOUS"), ("intraperitoneal", "INTRAPERITONEAL"),
              ("subcutaneous", "SUBCUTANEOUS"), ("intramuscular", "INTRAMUSCULAR"),
              ("dermal", "CUTANEOUS"), ("inhalation", "RESPIRATORY (INHALATION)"))

FLOAT3 = 3     # rounding for the compact JSON and for derived values


# --------------------------------------------------------------------------- small helpers
def nz(v):
    """The value, or None for anything blank / NaN / the strings pandas leaves behind."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    s = str(v).strip()
    if s == "" or s.lower() in ("nan", "none", "n/a", "#n/a", "na", "-", "--"):
        return None
    return v


def numeric(v):
    """v as a float when it reads as one, else None. Percentages are not converted here."""
    v = nz(v)
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v).replace(",", ""))
    return float(m.group(0)) if m else None


def r3(v, nd=FLOAT3):
    return None if v is None else round(float(v), nd)


def norm_name(s):
    """A drug name reduced to the form the different sources agree on: lowercase, no punctuation.

    The workbook and data/drugs.json write multi-word names with dots ('cromoglicic.acid'); DrugBank and
    openFDA write them with spaces. This only normalises punctuation and case -- it never substitutes one
    drug's name for another's."""
    s = str(s or "").lower().replace(".", " ").replace("-", " ").replace("_", " ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def sentences(text):
    return [re.sub(r"\s+", " ", s).strip() for s in SENT.split(text or "") if s.strip()]


def cell(value, source="", quote="", **extra):
    """One sourced value: the number, where it came from, the text it was read out of."""
    d = {"value": value, "source": source, "quote": (quote or "")[:400]}
    d.update(extra)
    return d


EMPTY = cell(None)


def has(c):
    return isinstance(c, dict) and c.get("value") is not None


# --------------------------------------------------------------------------- HTTP: disk cache, retries
class Http:
    """A cached GET. Everything fetched lands in the cache directory, so a second run is offline and the
    full pass never hits an API twice for the same URL. No API key is ever written into a file."""

    def __init__(self, cache_dir, offline=False, timeout=45, gap=0.25):
        self.dir, self.offline, self.timeout, self.gap = cache_dir, offline, timeout, gap
        self.last = 0.0
        self.log = []
        self.stats = Counter()
        os.makedirs(cache_dir, exist_ok=True)
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.key = os.environ.get("OPENFDA_API_KEY") or os.environ.get("FDA_API_KEY") or ""

    def get(self, url):
        path = os.path.join(self.dir, hashlib.sha1(url.encode()).hexdigest() + ".json")
        if os.path.exists(path):
            try:
                c = json.load(open(path, encoding="utf-8"))
            except ValueError:
                c = None
            if c:
                self.stats["cache_hit"] += 1
                self.log.append({"url": url, "status": c["status"], "bytes": len(c["text"]),
                                 "utc": c["utc"], "cached": True})
                return c["status"], c["text"]
        if self.offline:
            self.stats["offline_skip"] += 1
            return None, "offline: not in cache"
        send = url
        if url.startswith(OPENFDA) and self.key:      # the key stays out of the cache key and the log
            send = url + ("&" if "?" in url else "?") + "api_key=" + self.key
        status, text = None, ""
        for attempt in range(4):
            wait = self.gap - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                r = self.s.get(send, timeout=self.timeout)
                status, text = r.status_code, r.text
            except requests.RequestException as e:
                status, text = None, f"{type(e).__name__}: {e}"
            if status in (200, 404):
                break
            time.sleep(min(20, 2 ** (attempt + 1)))
        utc = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        self.stats["fetch_ok" if status == 200 else "fetch_fail"] += 1
        self.log.append({"url": url, "status": status, "bytes": len(text), "utc": utc, "cached": False})
        if status in (200, 404):
            json.dump({"status": status, "text": text, "utc": utc},
                      open(path, "w", encoding="utf-8"))
        return status, text

    def json(self, url):
        st, tx = self.get(url)
        if st != 200:
            return None
        try:
            return json.loads(tx)
        except ValueError:
            return None


# --------------------------------------------------------------------------- the FDA route legend
class Legend:
    """The FDA route-of-administration legend: ground truth for every mode this table emits.

    Keyed on SHORT NAME, as the brief asks, with a NAME index so a route written out in full
    ('RESPIRATORY (INHALATION)') finds its row. A route that the legend does not contain is kept as
    given and flagged, never quietly reassigned to a legend route that means something else."""

    def __init__(self, tsv_path, xlsx_path=None):
        self.by_short, self.by_name, self.source = {}, {}, ""
        rows = []
        if os.path.exists(tsv_path):
            with open(tsv_path, encoding="utf-8-sig", newline="") as f:
                rows = list(csv.DictReader(f, delimiter="\t"))
            self.source = f"FDA route legend TSV ({os.path.relpath(tsv_path, HERE)})"
        elif xlsx_path:
            df = pd.read_excel(xlsx_path, sheet_name=SHEET_LEGEND, engine="openpyxl")
            df.columns = [str(c).strip() for c in df.columns]
            rows = df.to_dict("records")
            self.source = f"FDA route legend sheet '{SHEET_LEGEND}'"
        for r in rows:
            r = {str(k).strip().upper(): r[k] for k in r}
            name = str(nz(r.get("NAME")) or "").strip().upper()
            short = str(nz(r.get("SHORT NAME")) or "").strip().upper()
            if not name or not short:
                continue
            code = str(nz(r.get("FDA CODE")) or "").strip()
            if code and code.isdigit():
                code = code.zfill(3)                   # the xlsx reads 013 as 13
            e = {"name": name, "short": short, "fda_code": code,
                 "nci": str(nz(r.get("NCI CONCEPT ID")) or "").strip(),
                 "definition": str(nz(r.get("DEFINITION")) or "").strip()}
            self.by_short[short] = e
            self.by_name[name] = e
        self.by_nci = {e["nci"]: e for e in self.by_short.values() if e["nci"]}

    def lookup(self, route):
        """A route string -> its legend row. NAME first, then SHORT NAME, then an NCI concept id."""
        if not route:
            return None
        k = str(route).strip().upper()
        return self.by_name.get(k) or self.by_short.get(k) or self.by_nci.get(k)

    @property
    def not_applicable(self):
        return self.lookup("NOT APPLICABLE") or self.lookup("NA")


# --------------------------------------------------------------------------- local label cache
def build_label_index(cache_dir, rebuild=False, verbose=True):
    """Index /mnt/project-files/DailyMed Data once and cache the result next to the request cache.

    The folder holds two different things, and they are not what the folder name suggests:

      *  openFDA drug/label.json responses, shaped {"meta":..., "results":[...]}. Each result carries
         openfda.route already in the FDA legend's vocabulary, plus the label's prose sections. This is
         the fallback source for modes AND a local, key-free, rate-limit-free source for bioavailability,
         half-life, dose and lethal-dose sentences.
      *  DailyMed spls.json search listings, shaped {"data":[{title,setid,...}], "metadata":{...}}. The
         drug they belong to is the drug_name query parameter inside metadata.current_url -- that is what
         we index on. These entries carry no route field at all; the only route signal is the dosage form
         inside the title, which is an inference and is labelled as one.

    The cache is a small JSON: {name -> {routes, route_counts, label_files, forms, titles}}.
    """
    path = os.path.join(cache_dir, "_label_index.json")
    if os.path.exists(path) and not rebuild:
        try:
            return json.load(open(path, encoding="utf-8"))
        except ValueError:
            pass
    idx = {}
    stats = Counter()

    def ent(name):
        return idx.setdefault(name, {"routes": {}, "label_files": [], "forms": {}, "titles": [],
                                     "aliases": []})

    files = sorted(glob.glob(os.path.join(DAILYMED_DIR, "*.json")))
    if verbose:
        print(f"  indexing {len(files)} local label files (once; cached afterwards)...", flush=True)
    for p in files:
        base = os.path.basename(p)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except (ValueError, OSError):
            stats["unparseable"] += 1
            continue
        if isinstance(d, dict) and "results" in d:
            stats["openfda_files"] += 1
            for r in (d.get("results") or []):
                o = r.get("openfda") or {}
                routes = [str(x).strip().upper() for x in (o.get("route") or []) if str(x).strip()]
                names = set()
                for key in ("generic_name", "substance_name", "brand_name"):
                    for v in (o.get(key) or []):
                        n = norm_name(v)
                        if n:
                            names.add(n)
                for n in names:
                    e = ent(n)
                    if base not in e["label_files"]:
                        e["label_files"].append(base)
                    for rt in routes:
                        e["routes"][rt] = e["routes"].get(rt, 0) + 1
        elif isinstance(d, dict) and "data" in d:
            stats["dailymed_files"] += 1
            u = ((d.get("metadata") or {}).get("current_url")) or ""
            q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
            raw = (q.get("drug_name") or [""])[0]
            n = norm_name(raw)
            if not n:
                stats["dailymed_no_name"] += 1
                continue
            e = ent(n)
            for row in (d.get("data") or []):
                t = str(row.get("title") or "").upper()
                if t and len(e["titles"]) < 6:
                    e["titles"].append(t[:200])
                for needle, route in FORM_ROUTE:
                    if needle in t:
                        e["forms"][route] = e["forms"].get(route, 0) + 1
                        break
        else:
            stats["other_shape"] += 1
    out = {"names": idx, "stats": dict(stats), "n_files": len(files),
           "built_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    os.makedirs(cache_dir, exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf-8"))
    if verbose:
        print(f"  label index: {len(idx)} names from {dict(stats)}", flush=True)
    return out


def build_drugbank_smiles(cache_dir, rebuild=False, verbose=True):
    """name -> moldb_smiles from drugbank_drugs_info.csv, streamed once and cached.

    The file is 232 MB and its header repeats column names ('id' three times, 'description' twice), so
    the columns are taken by position from the first occurrence of each name rather than by a dict
    reader, which would silently collapse the duplicates."""
    path = os.path.join(cache_dir, "_drugbank_smiles.json")
    if os.path.exists(path) and not rebuild:
        try:
            return json.load(open(path, encoding="utf-8"))
        except ValueError:
            pass
    out = {"map": {}, "rows": 0, "available": False}
    if not os.path.exists(DRUGBANK_CSV):
        return out
    if verbose:
        print("  streaming drugbank_drugs_info.csv (once; cached afterwards)...", flush=True)
    limit = csv.field_size_limit()
    try:
        csv.field_size_limit(10 ** 9)                  # single description fields run to megabytes
    except OverflowError:
        pass
    m = {}
    n = 0
    try:
        with open(DRUGBANK_CSV, encoding="utf-8", errors="replace", newline="") as f:
            rd = csv.reader(f)
            hdr = next(rd)
            try:
                i_name, i_sm = hdr.index("name"), hdr.index("moldb_smiles")
            except ValueError:
                return out
            i_ik = hdr.index("moldb_inchikey") if "moldb_inchikey" in hdr else None
            wide = max(i_name, i_sm, i_ik or 0)
            for row in rd:
                n += 1
                if len(row) <= wide:
                    continue
                nm = norm_name(row[i_name])
                sm = (row[i_sm] or "").strip()
                if nm and sm and nm not in m:
                    m[nm] = sm
    finally:
        csv.field_size_limit(limit)
    out = {"map": m, "rows": n, "available": True,
           "built_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    os.makedirs(cache_dir, exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf-8"))
    if verbose:
        print(f"  drugbank SMILES: {len(m)} names from {n} rows", flush=True)
    return out


def local_label_results(name_norm, index):
    """The openFDA label results stored locally for one normalised name, read on demand.

    Ranked, because a combination product matches too: an ibuprofen-and-famotidine label carries
    'famotidine' in openfda.substance_name, and reading a boxed warning out of it would attribute
    ibuprofen's cardiovascular warning to famotidine. So a record whose openfda.generic_name is this
    drug and nothing else comes first, then a single-ingredient record, then anything else. Callers
    read the prose in this order, so a single-ingredient label is always preferred."""
    e = (index.get("names") or {}).get(name_norm)
    if not e:
        return []
    out = []
    for base in e.get("label_files") or []:
        p = os.path.join(DAILYMED_DIR, base)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except (ValueError, OSError):
            continue
        for r in (d.get("results") or []):
            o = r.get("openfda") or {}
            gen = [norm_name(v) for v in (o.get("generic_name") or [])]
            subs = [norm_name(v) for v in (o.get("substance_name") or [])]
            brands = [norm_name(v) for v in (o.get("brand_name") or [])]
            if name_norm not in set(gen) | set(subs) | set(brands):
                continue
            if gen and all(g == name_norm for g in gen):
                rank = 0                      # this drug and only this drug
            elif len(subs) <= 1 and name_norm in gen:
                rank = 1                      # single active ingredient, named in generic_name
            elif name_norm in gen:
                rank = 2                      # named in generic_name beside others: a combination
            else:
                rank = 3                      # matched only through a substance or brand name
            out.append((rank, base, r))
    if not out:
        return []
    out.sort(key=lambda t: (t[0], t[1]))
    best = out[0][0]                          # keep only the best tier, so a combination product's
    return [(base, r) for rank, base, r in out if rank == best]   # prose never speaks for this drug


def label_prose(results):
    """All the prose of a set of label results, joined, for the sentence readers."""
    parts = []
    for _base, r in results:
        for k, v in r.items():
            if k == "openfda":
                continue
            if isinstance(v, list) and v and isinstance(v[0], str):
                parts.append(" ".join(v))
    return "\n".join(parts)


# --------------------------------------------------------------------------- name resolution
# Counter-ion, ester and hydrate words. A US label is filed under the salt actually in the product
# ("morphine sulfate", "metformin hydrochloride"), while the workbook and the WHO ATC index name the
# base substance. A salt of a substance is that substance for the purposes this table uses a label for
# -- route of administration, half-life, bioavailability -- so matching across a trailing run of these
# words is a nomenclature step, not a guess at a different drug. The matched name is always carried into
# the evidence string so a reader can see which salt the sentence came from; note that a dose read off a
# salt-form label is a dose of the salt, which is why the quote keeps the label's own wording.
SALT_WORDS = frozenset("""
sulfate sulphate hydrochloride hydrobromide hydroiodide chloride bromide iodide fluoride
sodium potassium calcium magnesium aluminum aluminium zinc lithium meglumine
acetate propionate butyrate valerate caproate caprylate decanoate undecylenate palmitate stearate
laurate enantate enanthate cypionate dipropionate furoate pivalate phosphate diphosphate pyrophosphate
nitrate dinitrate mononitrate tetranitrate sulfite carbonate bicarbonate borate
citrate tartrate bitartrate hemitartrate malate maleate fumarate succinate oxalate adipate
lactate gluconate glucuronate glycolate benzoate salicylate pamoate embonate
mesylate mesilate besylate besilate tosylate esylate napadisylate xinafoate edisylate isetionate
camsylate camsilate oleate linoleate aspartate glutamate orotate ascorbate
dihydrate monohydrate trihydrate hemihydrate sesquihydrate anhydrous hydrate hydrated
hcl hbr base free acid salt sesquihydrate
""".split())

# INN and USAN spell a number of substances differently. These pairs are spelling variants of one and
# the same substance, not substitutions of one drug for another, which is why the table is restricted to
# names whose identity is a matter of nomenclature. Every use is written into the evidence string as a
# spelling substitution, so a reader can check it; an alias that no source carries simply never fires.
INN_USAN = {
    "aciclovir": "acyclovir",
    "ciclosporin": "cyclosporine",
    "indometacin": "indomethacin",
    "beclometasone": "beclomethasone",
    "cromoglicic acid": "cromolyn",
    "rifampicin": "rifampin",
    "lignocaine": "lidocaine",
    "frusemide": "furosemide",
    "glibenclamide": "glyburide",
    "amoxycillin": "amoxicillin",
    "paracetamol": "acetaminophen",
    "salbutamol": "albuterol",
    "oestradiol": "estradiol",
    "noradrenaline": "norepinephrine",
    "adrenaline": "epinephrine",
    "dothiepin": "dosulepin",
    "sulphasalazine": "sulfasalazine",
    "tioguanine": "thioguanine",
    "trimeprazine": "alimemazine",
}
# The pairs are spelling variants of one substance, so the substitution is good in either direction:
# the workbook carries INN spellings, DrugBank and ChEMBL mix the two, and US labels carry USAN.
INN_USAN = dict(INN_USAN, **{v: k for k, v in INN_USAN.items()})


def openfda_query_names(name):
    """The spellings a live openFDA query is tried under: the drug's own name, then its USAN spelling.

    The workbook carries INN spellings and a US label is filed under the USAN one, so an openFDA search
    for 'aciclovir' returns nothing while 'acyclovir' returns the drug. Only the spelling changes -- the
    substance is the same -- and the spelling actually used is written into the evidence string."""
    n = name.replace(".", " ")
    out = [(n, "")]
    alias = INN_USAN.get(norm_name(name))
    if alias and norm_name(alias) != norm_name(name):
        out.append((alias, f" (searched under the USAN spelling '{alias}' for INN '{n}')"))
    return out


class NameIndex:
    """Match a workbook drug name onto a source's names without ever guessing a different drug.

    Exact normalised match first; then the same name under its INN/USAN spelling variant; then, only for
    a multi-word name, its first word -- which turns 'glycopyrronium bromide' into 'glycopyrronium' and
    'calcium folinate' into 'calcium', so the first word is accepted only when it is unique in the source
    and at least five characters long; then the salt, ester or hydrate forms of the name, where every word
    the source adds is a counter-ion or hydrate word from SALT_WORDS. Anything looser is refused and the
    row stays empty with a reason. Every non-exact match names, in the string it returns, the source name
    it actually landed on, so the substitution travels with the value into the provenance table."""

    def __init__(self, names):
        self.exact = set()
        self.first = defaultdict(set)
        for n in names:
            n = norm_name(n)
            if not n:
                continue
            self.exact.add(n)
            self.first[n.split()[0]].add(n)

    def _salt_forms(self, n):
        """Source names that are `n` plus a trailing run of counter-ion / hydrate words only."""
        out = []
        for cand in self.first.get(n.split()[0]) or set():
            if cand == n or not cand.startswith(n + " "):
                continue
            tail = cand[len(n) + 1:].split()
            if tail and all(w in SALT_WORDS for w in tail):
                out.append(cand)
        return sorted(out, key=lambda c: (len(c), c))

    def _direct(self, n, note):
        """Exact, base-word and salt-form lookup for one spelling of the name."""
        if n in self.exact:
            return n, "exact name match" + note
        head = n.split()[0]
        if len(n.split()) > 1 and len(head) >= 5:
            if head in self.exact:
                return head, f"matched on the base name '{head}' of '{n}'" + note
            cands = self.first.get(head) or set()
            if len(cands) == 1:
                only = next(iter(cands))
                return only, (f"matched '{n}' to the single source name sharing its base word: "
                              f"'{only}'") + note
        salts = self._salt_forms(n)
        if salts:
            pick = salts[0]
            extra = f"; the source also files it as {', '.join(salts[1:3])}" if len(salts) > 1 else ""
            return pick, (f"matched '{n}' to the salt/ester form the source files it under: "
                          f"'{pick}'" + extra) + note
        return None, ""

    def resolve(self, name):
        n = norm_name(name)
        if not n:
            return None, ""
        hit, why = self._direct(n, "")
        if hit:
            return hit, why
        alias = INN_USAN.get(n)
        if alias and alias != n:
            hit, why = self._direct(alias, f" (INN '{n}' spelled '{alias}' by this source)")
            if hit:
                return hit, why
        return None, f"no name in this source matches '{n}'"


# --------------------------------------------------------------------------- WHO ATC / DDD
def who_group(http, code):
    """The level-5 members of an ATC level-4 group with the DDD the WHO index prints per route.

    Reuses the parsing tools/build_cohort.py already does for this index: the page prints one row per
    drug and a further row per extra route, with the drug's own cells left blank, so the current ATC code
    carries down the table."""
    url = WHO.format(code)
    st, tx = http.get(url)
    if st != 200:
        return [], url, False
    body = tx[tx.find("ATC code"):]
    body = body[:body.find("</table>")] if "</table>" in body else body
    members, cur = [], None
    for row in re.findall(r"<tr>(.*?)</tr>", body, re.S):
        raw = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).replace("\xa0", " ").strip() for c in raw]
        if len(cells) < 5:
            continue
        acode = cells[0]
        if re.fullmatch(r"[A-Z]\d{2}[A-Z]{2}\d{2}", acode):
            cur = {"atc": acode, "name": cells[1].strip(), "ddd": {}}
            members.append(cur)
        elif acode or cur is None:
            continue
        ddd, unit, adm = cells[2], cells[3], cells[4]
        if cur is not None and ddd and adm:
            try:
                v = float(ddd)
            except ValueError:
                continue
            mult = UNIT_MG.get(unit)
            route = WHO_ROUTE.get(adm.upper())
            if mult and route:
                cur["ddd"][route] = {"mg": round(v * mult, 4), "who_adm": adm,
                                     "printed": f"{ddd} {unit} {adm}", "url": url}
    return members, url, True


def who_levels(http, code):
    """{ATC code: name} for every level at or above this group, out of the group page's breadcrumb."""
    st, tx = http.get(WHO.format(code))
    out = {}
    if st != 200:
        return out
    head = tx[:tx.find("ATC code")] if "ATC code" in tx else tx
    for m in re.finditer(r"([A-Z]\d*[A-Z]*\d*)\s*<b><a href=\"\./\?code=([A-Z0-9]+)&[^\"]*\">(.*?)</a></b>",
                         head, re.S):
        c = m.group(2)
        if code.startswith(c):
            out[c] = html.unescape(re.sub(r"<[^>]+>", "", m.group(3))).strip()
    return out


# --------------------------------------------------------------------------- PK-DB
def pkdb_doses(http, name, legend, page_size=200):
    """Literature dosing per route for one substance from PK-DB, as {legend route NAME: {...}}.

    Only part of this open API is usable without credentials, which was measured rather than assumed:

      *  /api/v1/filter/?concise=true&interventions__substance=<name> works and returns a uuid plus
         per-table counts. interventions__substance is the criterion that actually filters; the other
         substance criteria silently return zero or the unfiltered totals, so they are not used.
      *  /api/v1/interventions/?uuid=<uuid> works, and gives per study the route, the form, the
         application (single / multiple dose), the measurement type, the value and the unit. That is
         real literature dosing per route, which is what dose_mg and dose_interval_h want.
      *  /api/v1/outputs/, /api/v1/pkdata/outputs/ and /api/v1/subsets/ return "Not found." or count 0
         even when the filter reports hundreds of outputs: the PK parameters (half-life, AUC,
         bioavailability, clearance) need authentication, and this project has no credentials. So
         half-life and bioavailability do not come from here -- they come from the label prose and from
         the user's own curated table.

    A zero count is a real absence: the caller falls through to the next source. The uuid is short-lived,
    so the interventions call follows the filter call immediately."""
    sub = norm_name(name).replace(" ", "+")
    if not sub:
        return {}, "", 0
    furl = f"{PKDB}/filter/?format=json&concise=true&interventions__substance={sub}"
    js = http.json(furl)
    if not isinstance(js, dict):
        return {}, furl, 0
    uuid = js.get("uuid")
    n_int = int(js.get("interventions") or 0)
    if not uuid or n_int <= 0:
        return {}, furl, 0
    iurl = f"{PKDB}/interventions/?format=json&uuid={uuid}&page_size={page_size}"
    ij = http.json(iurl)
    data = ij if isinstance(ij, list) else ((ij or {}).get("data") or ij or {})
    if isinstance(data, dict):
        data = data.get("data") or []
    out = {}
    for it in (data or []):
        if not isinstance(it, dict):
            continue
        mt = str(it.get("measurement_type") or "").lower()
        if "dose" not in mt or mt == "qualitative-dosing":
            continue
        route = it.get("route")
        rname = ""
        if isinstance(route, dict):
            rname = str(route.get("label") or route.get("name") or route.get("sid") or "")
        elif route:
            rname = str(route)
        e = legend.lookup(rname.upper()) or legend.lookup(
            {"IV": "INTRAVENOUS", "PO": "ORAL", "IM": "INTRAMUSCULAR",
             "SC": "SUBCUTANEOUS"}.get(rname.upper(), ""))
        if e is None:
            continue                                  # an unmapped route is skipped, never reassigned
        v = None
        for k in ("value", "median", "mean"):
            v = numeric(it.get(k))
            if v is not None:
                break
        unit = str(it.get("unit") or "").strip()
        mult = UNIT_MG.get(unit)
        if v is None or mult is None:
            continue
        study = (it.get("study") or {}) if isinstance(it.get("study"), dict) else {}
        sid = study.get("sid") or study.get("name") or ""
        app = str(it.get("application") or "").lower()
        tau = None
        if "multiple" in app:
            te, t = numeric(it.get("time_end")), numeric(it.get("time"))
            tu = str(it.get("time_unit") or "").lower()
            if te is not None and t is not None and te > t and tu in ("h", "hr", "hour", "hours"):
                tau = te - t
        slot = out.setdefault(e["name"], {"doses": [], "taus": [], "studies": set(), "form": ""})
        slot["doses"].append(v * mult)
        if tau:
            slot["taus"].append(tau)
        if sid:
            slot["studies"].add(str(sid))
        if not slot["form"] and it.get("form"):
            slot["form"] = str(it.get("form"))
    built = {}
    for rname, s in out.items():
        if not s["doses"]:
            continue
        doses = sorted(s["doses"])
        med = doses[len(doses) // 2] if len(doses) % 2 else (doses[len(doses) // 2 - 1]
                                                             + doses[len(doses) // 2]) / 2.0
        studies = ", ".join(sorted(s["studies"])[:4])
        q = (f"PK-DB median of {len(doses)} reported {rname.lower()} dosing intervention(s) "
             f"= {round(med, 4)} mg"
             + (f", form {s['form']}" if s["form"] else "")
             + (f"; studies {studies}" if studies else ""))
        built[rname] = {
            "dose": cell(round(med, 4), f"PK-DB interventions ({iurl})", q, unit="mg"),
            "tau": (cell(round(sorted(s["taus"])[len(s["taus"]) // 2], 3),
                         f"PK-DB interventions ({iurl})",
                         f"PK-DB multiple-dose interval for {rname.lower()}"
                         f" across {len(s['taus'])} intervention(s)", unit="h")
                    if s["taus"] else EMPTY),
        }
    return built, iurl, n_int


# --------------------------------------------------------------------------- label prose readers
def read_bioavailability(text, source):
    for s in sentences(text):
        low = s.lower()
        if "bioavailab" not in low or any(w in low for w in SPECIAL):
            continue
        m = (re.search(NUM + r"\s*(?:%|percent)?\s*(?:to|-|–|and)\s*" + NUM + r"\s*(?:%|percent)", s, re.I)
             or re.search(r"(?:is|was|of|approximately|about|around)\s*~?\s*" + NUM + r"\s*(?:%|percent)",
                          s, re.I))
        if not m:
            continue
        vals = [float(g) for g in m.groups() if g]
        v = sum(vals) / len(vals) / 100.0
        if 0.01 <= v <= 1.0:
            return cell(round(v, 3), source, s)
    return EMPTY


def read_half_life(text, source):
    best = None
    for s in sentences(text):
        low = s.lower()
        if "half-life" not in low and "half life" not in low:
            continue
        if any(w in low for w in SPECIAL):
            continue
        m = (re.search(NUM + r"\s*(?:to|-|–)\s*" + NUM + r"\s*(?:hours?|hrs?|h\b)", s, re.I)
             or re.search(r"(?:is|was|of|approximately|about|around)\s*~?\s*" + NUM +
                          r"\s*(?:hours?|hrs?|h\b)", s, re.I))
        if not m:
            continue
        vals = [float(g) for g in m.groups() if g]
        v = sum(vals) / len(vals)
        if 0.05 <= v <= 400:
            c = cell(round(v, 2), source, s)
            if "eliminat" in low:
                return c
            best = best or c
    return best or EMPTY


def read_dose(text, source):
    """A label maintenance dose in mg and its interval in hours, from one sentence that states both."""
    for s in sentences(text):
        low = s.lower()
        if "mg" not in low or any(w in low for w in SPECIAL):
            continue
        if not re.search(r"recommended|usual|maintenance|the dose", low):
            continue
        md = re.search(NUM + r"\s*mg\b", s, re.I)
        if not md:
            continue
        dose = float(md.group(1))
        if not (0.001 <= dose <= 10000):
            continue
        tau = None
        if re.search(r"\b(?:once|one time)\s+(?:a|per)?\s*day|\bdaily\b|q\.?d\.?|at bedtime|every 24 hours",
                     low):
            tau = 24.0
        elif re.search(r"twice\s+(?:a|per)?\s*day|\bb\.?i\.?d\.?|every 12 hours", low):
            tau = 12.0
        elif re.search(r"three times\s+(?:a|per)?\s*day|\bt\.?i\.?d\.?|every 8 hours", low):
            tau = 8.0
        elif re.search(r"four times\s+(?:a|per)?\s*day|\bq\.?i\.?d\.?|every 6 hours", low):
            tau = 6.0
        else:
            mh = re.search(r"every\s+" + NUM + r"\s*hours?", low)
            if mh:
                tau = float(mh.group(1))
        if tau:
            return cell(dose, source, s), cell(tau, source, s)
    return EMPTY, EMPTY


def read_lethal_dose(text, source):
    """The lowest stated acute lethal dose in mg/kg, with its kind, species and route.

    A number only counts when it sits beside a lethal-dose statement: labels are full of 'doses up to
    200 mg/kg' and 'a single oral dose of 1000 mg/kg was without effect', which are not lethal doses.
    Kind, species and route are read out of the same sentence, and stay empty when the sentence does not
    say -- they are never assumed."""
    found = []
    for s in sentences(text):
        low = s.lower()
        if "mg/kg" not in low or not re.search(LETHAL, s, re.I):
            continue
        if any(n in low for n in NEGATED):
            continue
        flat = re.sub(r"(?<=\d),(?=\d\d\d)", "", s)
        near = (re.findall(LETHAL + r"[^.]{0,90}?" + NUM + r"(?:\s*(?:to|-|–|and)\s*" + NUM +
                           r")?\s*mg/kg", flat, re.I)
                + re.findall(NUM + r"(?:\s*(?:to|-|–|and)\s*" + NUM + r")?\s*mg/kg[^.]{0,40}?" +
                             LETHAL, flat, re.I))
        for groups in near:
            g = groups if isinstance(groups, tuple) else (groups,)
            vals = [float(x) for x in g if x]
            vals = [v for v in vals if v >= 1]
            if not vals:
                continue
            kind = ("LD50" if re.search(r"LD\s*50|median lethal", s, re.I)
                    else "minimum lethal dose" if "minimum lethal" in low else "lethal dose")
            sp = next((w for w in SPECIES if w in low), "")
            sp = {"mice": "mouse", "rats": "rat", "dogs": "dog", "rabbits": "rabbit",
                  "monkeys": "monkey", "humans": "human"}.get(sp, sp)
            rt = next((r for k, r in TOX_ROUTES if k in low), "")
            found.append((min(vals), s, kind, sp, rt))
    if not found:
        return EMPTY
    v, s, kind, sp, rt = min(found, key=lambda r: r[0])
    return cell(v, source, s, unit="mg/kg", kind=kind, species=sp, route=rt, bound="",
                use_in_ti=True)


def read_endpoint(results, source):
    """The label's own most serious documented toxicity, for the primary toxicity endpoint column."""
    for field in ("boxed_warning", "warnings_and_precautions", "warnings", "adverse_reactions"):
        for _base, r in results:
            v = r.get(field)
            if isinstance(v, list) and v and isinstance(v[0], str):
                ss = [x for x in sentences(" ".join(v)) if len(x) > 40 and not x.isupper()]
                if ss:
                    return cell(f"{field.replace('_', ' ')}: {ss[0][:240]}", source, ss[0])
    return EMPTY


# --------------------------------------------------------------------------- RDKit
def smiles_check(smi):
    """(mol, ok, error text). The user's 'inbuilt function to check for error in SMILES'.

    MolFromSmiles with sanitize=True is the check. When it fails the structure is re-parsed without
    sanitisation and put through DetectChemistryProblems and SanitizeMol, so the row carries RDKit's own
    description of what is wrong rather than a bare 'invalid'."""
    if not smi:
        return None, False, "no SMILES from any permitted source"
    mol = Chem.MolFromSmiles(smi, sanitize=True)
    if mol is not None:
        return mol, True, ""
    raw = Chem.MolFromSmiles(smi, sanitize=False)
    if raw is None:
        return None, False, "RDKit could not parse the SMILES at all (MolFromSmiles returned None)"
    msgs = []
    try:
        for p in Chem.DetectChemistryProblems(raw):
            msgs.append(f"{p.GetType()}: {p.Message()}")
    except Exception as e:                                    # noqa: BLE001 - report, never crash a run
        msgs.append(f"DetectChemistryProblems raised {type(e).__name__}: {e}")
    try:
        Chem.SanitizeMol(raw)
    except Exception as e:                                    # noqa: BLE001
        msgs.append(f"SanitizeMol raised {type(e).__name__}: {e}")
    return None, False, "; ".join(msgs)[:500] or "sanitisation failed without a reported problem"


def rdkit_features(mol):
    """QED's composite and its eight component properties, plus the Hansch MR term and a few extras.

    ALERTS comes from RDKit's own QED implementation (QED.properties(mol).ALERTS), not a hand-rolled
    SMARTS count, and the composite is computed from the same property tuple so the two always agree."""
    p = QED.properties(mol)
    des = {n: QED.ads(float(v), QED.adsParameters[n]) for n, v in p._asdict().items()}
    return {
        "qed": round(QED.qed(mol, qedProperties=p), 4),
        "mw": round(float(p.MW), 3), "alogp": round(float(p.ALOGP), 3),
        "hba": int(p.HBA), "hbd": int(p.HBD), "psa": round(float(p.PSA), 2),
        "rotb": int(p.ROTB), "arom": int(p.AROM), "alerts": int(p.ALERTS),
        "molmr": round(Crippen.MolMR(mol), 3),
        "exact_mw": round(Descriptors.ExactMolWt(mol), 4),
        "tpsa": round(rdMolDescriptors.CalcTPSA(mol), 2),
        "fsp3": round(rdMolDescriptors.CalcFractionCSP3(mol), 4),
        "heavy_atoms": mol.GetNumHeavyAtoms(),
        "rings": rdMolDescriptors.CalcNumRings(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "charge": Chem.GetFormalCharge(mol),
        "lipinski_hbd": rdMolDescriptors.CalcNumLipinskiHBD(mol),
        "lipinski_hba": rdMolDescriptors.CalcNumLipinskiHBA(mol),
        "qed_limiting_term": min(QED_PROPS, key=lambda n: des[n]),
    }


# --------------------------------------------------------------------------- the workbook's formulas
FREE_CONC_FORMULA = "=(1.44*AA{r}*AB{r}*AC{r}/AD{r})"


def free_concentration(F, half_life, dose, interval):
    """=(1.44*F*t_half*Dose/tau): the workbook's average amount in the body at steady state."""
    if None in (F, half_life, dose, interval) or not interval:
        return None
    return round(1.44 * F * half_life * dose / interval, 4)


def therapeutic_index(tox, act):
    """The user's own definition: LOG10(in-vivo toxicity) - LOG10(1 / in-vivo activity)."""
    if not tox or not act or tox <= 0 or act <= 0:
        return None
    return round(math.log10(tox) - math.log10(1.0 / act), 4)


def therapeutic_index_classical(tox, act):
    """log10(tox / act), the conventional index, emitted beside the user's as an extra column."""
    if not tox or not act or tox <= 0 or act <= 0:
        return None
    return round(math.log10(tox / act), 4)


def dose_corrected_bioavailability(F, dose):
    if F is None or not dose:
        return None
    return round(F / dose, 6)


# --------------------------------------------------------------------------- the PK/tox few-shot tables
def load_pk_tables(verbose=True):
    """The user's manually curated PK/tox tables, read first because they are the pattern to generalise.

    tools/inputs/A02BA_pk_tox.json is the annotation shape: per drug, F / half_life_h / dose_mg /
    dose_interval_h / invivo_act / invivo_tox, each a {value, unit, source} and a toxicity additionally
    {species, route, kind, bound, use_in_therapeutic_index}. The earlier runs of the same group under
    /mnt/project-files are read too and reused rather than re-derived."""
    out, metas, seen = {}, [], []
    for path in sorted(glob.glob(PK_TABLE.format("*"))) + [PRIOR_PKTOX]:
        if not os.path.exists(path):
            continue
        try:
            js = json.load(open(path, encoding="utf-8"))
        except (ValueError, OSError):
            continue
        seen.append(path)
        if js.get("meta"):
            metas.append({"file": path, **js["meta"]})
        for d in (js.get("drugs") or []):
            key = norm_name(d.get("name"))
            if not key:
                continue
            cur = out.setdefault(key, {"_files": []})
            for k, v in d.items():
                if k not in cur or cur.get(k) in (None, ""):
                    cur[k] = v
            if path not in cur["_files"]:
                cur["_files"].append(path)
    if verbose and seen:
        print(f"  PK/tox tables: {len(out)} drugs from {', '.join(os.path.basename(p) for p in seen)}",
              flush=True)
    return out, metas, seen


def load_prior_features(verbose=True):
    """The earlier A02BA run's features.csv, keyed by drug name, reused rather than recomputed."""
    out = {}
    if not os.path.exists(PRIOR_FEATURES):
        return out
    with open(PRIOR_FEATURES, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            k = norm_name(row.get("Generic Name"))
            if k:
                out.setdefault(k, row)
    if verbose and out:
        print(f"  prior run features.csv: {len(out)} drugs", flush=True)
    return out


def from_table(entry, key, unit_hint=None):
    """One cell out of a PK/tox table entry, carrying the table's own source string as the quote."""
    c = (entry or {}).get(key)
    if not isinstance(c, dict) or c.get("value") is None:
        return EMPTY
    src = c.get("source") or "curated PK/tox table"
    extra = {}
    for a, b in (("species", "species"), ("route", "route"), ("kind", "kind"), ("bound", "bound")):
        if c.get(a) is not None:
            extra[b] = c[a]
    if "use_in_therapeutic_index" in c:
        extra["use_in_ti"] = bool(c["use_in_therapeutic_index"])
    return cell(c["value"], f"curated PK/tox table: {src}", src,
                unit=c.get("unit") or unit_hint or "", **extra)


# --------------------------------------------------------------------------- provenance
class Provenance:
    """One row per sourced value: compound, field, value, source url, verbatim quote, retrieved_at."""

    def __init__(self):
        self.rows = []

    def add(self, compound, atc, mode, field, c, status="found", retrieved=""):
        if not isinstance(c, dict):
            return
        self.rows.append({
            "compound": compound, "atc_code": atc, "mode_of_administration": mode, "field": field,
            "value": "" if c.get("value") is None else c.get("value"),
            "unit": c.get("unit", "") or "",
            "source": c.get("source", "") or "",
            "source_url": first_url(c.get("source", "")) or first_url(c.get("quote", "")) or "",
            "quote": (c.get("quote") or "").replace("\n", " ")[:600],
            "retrieved_at": retrieved,
            "status": status,
        })

    def note(self, compound, atc, mode, field, reason, retrieved=""):
        self.rows.append({
            "compound": compound, "atc_code": atc, "mode_of_administration": mode, "field": field,
            "value": "", "unit": "", "source": "", "source_url": "", "quote": reason[:600],
            "retrieved_at": retrieved, "status": "not_established",
        })


URL_RE = re.compile(r"https?://[^\s'\"()<>]+")


def first_url(s):
    m = URL_RE.search(str(s or ""))
    return m.group(0) if m else ""


# --------------------------------------------------------------------------- mode resolution
def resolve_modes(drug, atc, legend, label_index, label_names, http, prov, offline, retrieved):
    """Every mode for one (drug, ATC code), by the user's rule, each mapped to the FDA legend.

    Returns a list of dicts: {entry (legend row), source (branch), evidence, raw}. Never empty: when
    nothing states a route the list holds a single NOT APPLICABLE row with the reason in its evidence."""
    name = drug["name"]
    out, seen = [], set()

    def push(route, branch, evidence, raw=None):
        e = legend.lookup(route)
        if e is None:
            # Not in the legend. Keep the route as given and say so -- do not reassign it.
            e = {"name": str(route).upper(), "short": str(route).upper(), "fda_code": "",
                 "nci": "", "definition": ""}
            evidence += f" | '{route}' is not in the FDA route legend; kept verbatim, unmapped"
            branch = branch + "_unmapped"
        if e["short"] in seen:
            return
        seen.add(e["short"])
        out.append({"entry": e, "source": branch, "evidence": evidence, "raw": raw or str(route)})

    # ---- branch A: the WHO ATC/DDD AdmR routes, curated per (CID, ATC code) in data/drugs.json
    admr = drug.get("_admr", {}).get(atc) or []
    for rt in admr:
        push(rt, "atc_ddd_admr",
             f"WHO ATC/DDD AdmR for {atc}, curated in data/drugs.json (meta.sources.who_atc = "
             f"https://atcddd.fhi.no/atc_ddd_index/) as '{rt}'", rt)
    if out:
        return out

    # ---- branch B: openfda.route from a US drug label. Local cache first, then the live API.
    key, why = label_names.resolve(name)
    if key:
        e = (label_index.get("names") or {}).get(key) or {}
        routes = sorted((e.get("routes") or {}).items(), key=lambda r: (-r[1], r[0]))
        for rt, n in routes:
            push(rt, "openfda_route",
                 f"openfda.route on {n} local US label record(s) for '{key}' ({why}); "
                 f"source files {', '.join((e.get('label_files') or [])[:3])}", rt)
        if out:
            return out
    if not offline:
        for spelling, note in openfda_query_names(name):
            q = urllib.parse.quote(f'openfda.generic_name:"{spelling}"')
            url = f"{OPENFDA}?search={q}&count=openfda.route.exact&limit=50"
            js = http.json(url)
            rows = [(str(r["term"]).upper(), int(r["count"]))
                    for r in ((js or {}).get("results") or []) if r.get("term")]
            rows.sort(key=lambda r: (-r[1], r[0]))
            for rt, n in rows:
                push(rt, "openfda_route",
                     f"openFDA route count {n} for '{name}'{note} ({url})", rt)
            if out:
                return out

    # ---- branch C: a dosage form on a DailyMed SPL listing title. An inference, labelled as one.
    if key:
        e = (label_index.get("names") or {}).get(key) or {}
        forms = sorted((e.get("forms") or {}).items(), key=lambda r: (-r[1], r[0]))
        for rt, n in forms:
            t = (e.get("titles") or [""])[0]
            push(rt, "dailymed_form",
                 f"inferred from DailyMed dosage form on {n} SPL listing title(s) for '{key}' "
                 f"(e.g. '{t[:120]}'); the listing states no route, so this is a dosage-form inference,"
                 f" not a label route", rt)
        if out:
            return out

    # ---- branch D: nothing states a route.
    na = legend.not_applicable
    reason = (f"no route for {atc}: the WHO ATC/DDD AdmR column is empty in data/drugs.json, and "
              + (f"no US label record matches this name ({why})" if not key else
                 f"the matched label records for '{key}' carry no route and no dosage form"))
    if offline:
        reason += "; run was --offline, so the live openFDA route count was not tried"
    e = na or {"name": "NOT APPLICABLE", "short": "NA", "fda_code": "312", "nci": "C48623",
               "definition": "Routes of administration are not applicable."}
    out.append({"entry": e, "source": "not_applicable", "evidence": reason, "raw": ""})
    return out


# --------------------------------------------------------------------------- column layout
ID_COLS = [
    "row_id", "cid", "generic_name", "drug_title", "national_drug_code", "inchikey",
    "atc_code", "atc_l1", "atc_l2", "atc_l3", "atc_l4", "atc_l5",
    "atc_l1_name", "atc_l2_name", "atc_l3_name", "atc_l4_name", "atc_l5_name", "atc_name_source",
    "sheet_level1_anatomical", "sheet_level2_therapeutic", "sheet_level3_mechanism",
    "sheet_level4_chemical_group",
    "mode_of_administration", "mode_name", "mode_fda_code", "mode_nci_concept_id", "mode_definition",
    "mode_source", "mode_evidence", "mode_raw", "mode_rank", "n_modes", "has_multiple_modes",
]
SMILES_COLS = ["smiles", "smiles_source", "smiles_ok", "smiles_error", "sheet_smiles"]
FEAT_COLS = [
    "qed", "mw", "alogp", "hba", "hbd", "psa", "rotb", "arom", "alerts", "molmr",
    "exact_mw", "tpsa", "fsp3", "heavy_atoms", "rings", "formula", "charge",
    "lipinski_hbd", "lipinski_hba", "qed_limiting_term", "features_source",
]
SHEET_COLS = [
    "sheet_molecular_weight", "sheet_lipophilicity_logd", "sheet_hydrogen_bond_donors",
    "sheet_hydrogen_bond_acceptors", "sheet_topological_surface_area", "sheet_rotatable_bonds",
    "sheet_aromatic_rings", "sheet_hammett_substituent_constant",
    "sheet_molecular_refractivity_or_taft", "sheet_qed", "sheet_mode_of_administration",
    "sheet_primary_biological_target", "sheet_in_vitro_toxicity", "sheet_in_vitro_activity",
    "sheet_in_vivo_toxicity", "sheet_in_vivo_activity", "sheet_therapeutic_index",
    "sheet_bioavailability", "sheet_half_life", "sheet_dosage", "sheet_dose_interval",
    "sheet_in_vivo_free_drug_concentration", "sheet_primary_toxicity_endpoint",
]
PK_COLS = [
    "bioavailability_F", "bioavailability_source", "bioavailability_quote",
    "half_life_h", "half_life_source", "half_life_quote",
    "dose_mg", "dose_mg_source", "dose_mg_quote",
    "dose_interval_h", "dose_interval_source", "dose_interval_quote",
    "in_vivo_activity", "in_vivo_activity_unit", "in_vivo_activity_kind",
    "in_vivo_activity_source", "in_vivo_activity_quote",
    "in_vivo_toxicity", "in_vivo_toxicity_unit", "tox_dose_kind", "tox_species", "tox_route",
    "tox_bound", "tox_use_in_ti", "in_vivo_toxicity_source", "in_vivo_toxicity_quote",
    "in_vitro_activity", "in_vitro_toxicity", "primary_biological_target",
    "primary_toxicity_endpoint", "primary_toxicity_endpoint_source",
]
DERIVED_COLS = [
    "free_conc", "free_conc_formula", "free_conc_basis",
    "therapeutic_index", "therapeutic_index_classical", "therapeutic_index_basis",
    "dose_corrected_bioavailability", "who_ddd_mg", "who_ddd_printed", "fill_note",
]
ALL_COLS = ID_COLS + SMILES_COLS + FEAT_COLS + SHEET_COLS + PK_COLS + DERIVED_COLS

# The compact JSON's short keys. Names and definitions live in meta, keyed by code, so the rows stay
# small: the per-row payload is codes and numbers only.
JSON_COLS = [
    ("rid", "row_id"), ("cid", "cid"), ("nm", "generic_name"), ("atc", "atc_code"),
    ("a1", "atc_l1"), ("a2", "atc_l2"), ("a3", "atc_l3"), ("a4", "atc_l4"),
    ("md", "mode_of_administration"), ("ms", "mode_source"), ("nmd", "n_modes"),
    ("mm", "has_multiple_modes"),
    ("ok", "smiles_ok"), ("qed", "qed"), ("mw", "mw"), ("lgp", "alogp"), ("hba", "hba"),
    ("hbd", "hbd"), ("psa", "psa"), ("rtb", "rotb"), ("arm", "arom"), ("alr", "alerts"),
    ("mr", "molmr"), ("f3", "fsp3"), ("hvy", "heavy_atoms"),
    ("F", "bioavailability_F"), ("t12", "half_life_h"), ("dose", "dose_mg"),
    ("tau", "dose_interval_h"), ("fc", "free_conc"), ("ti", "therapeutic_index"),
    ("tic", "therapeutic_index_classical"), ("dcb", "dose_corrected_bioavailability"),
    ("tox", "in_vivo_toxicity"), ("tk", "tox_dose_kind"), ("tsp", "tox_species"),
    ("trt", "tox_route"), ("act", "in_vivo_activity"), ("ddd", "who_ddd_mg"),
]
NUM_FIELDS = {"qed", "mw", "alogp", "psa", "molmr", "fsp3", "bioavailability_F", "half_life_h",
              "dose_mg", "dose_interval_h", "free_conc", "therapeutic_index",
              "therapeutic_index_classical", "dose_corrected_bioavailability", "in_vivo_toxicity",
              "in_vivo_activity", "who_ddd_mg"}
# F / dose_mg is a small ratio: three decimals would round 0.00075 to 0.001 and throw the value away,
# so the ratio columns keep more places. Everything else rounds to three.
WIDE_FIELDS = {"dose_corrected_bioavailability": 6, "bioavailability_F": 4}


# --------------------------------------------------------------------------- build
def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=SRC_DEFAULT, help="the source workbook (xlsx)")
    # The two CSVs are the full record and are megabytes wide, so they live in
    # data/ beside the other source tables. Only the compact JSON goes under
    # site/, which the page serves and tools/check_site.py holds to a size cap.
    ap.add_argument("--out", default=os.path.join(HERE, "data", "clean_drugs.csv"),
                    help="the long table (CSV)")
    ap.add_argument("--json-out", default=os.path.join(HERE, "site", "data", "clean_drugs.json"),
                    help="the same table compacted for the web explorer")
    ap.add_argument("--prov", default=os.path.join(HERE, "data", "clean_provenance.csv"),
                    help="the provenance table: one row per sourced value")
    ap.add_argument("--cache", default=CACHE_DEFAULT, help="request and index cache directory")
    ap.add_argument("--limit", type=int, default=0, metavar="N",
                    help="only the first N drugs, for a smoke test")
    ap.add_argument("--atc4", default="", metavar="A02BA",
                    help="restrict to one ATC level-4 chemical group")
    ap.add_argument("--offline", action="store_true",
                    help="no network: everything from the cache and the local files")
    ap.add_argument("--rebuild-index", action="store_true",
                    help="re-read the 232 MB DrugBank CSV and the local label folder")
    ap.add_argument("--progress", type=int, default=50, metavar="N",
                    help="print a progress line every N drugs")
    a = ap.parse_args(argv)
    json_out = a.json_out or os.path.splitext(a.out)[0] + ".json"
    started = dt.datetime.now(dt.timezone.utc)
    retrieved = started.isoformat(timespec="seconds")
    t0 = time.time()

    print(f"curate_dataset: {'OFFLINE' if a.offline else 'online'} run started {retrieved}")
    print(f"  source {a.src}")

    # ---------------- inputs
    legend = Legend(FDA_ROUTES_TSV, a.src if os.path.exists(a.src) else None)
    if not legend.by_short:
        sys.exit("the FDA route legend could not be loaded; it is ground truth, so refusing to continue")
    print(f"  FDA route legend: {len(legend.by_short)} routes from {legend.source}")

    df = pd.read_excel(a.src, sheet_name=SHEET_WORK, header=1, engine="openpyxl")
    df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in df.columns]
    raw_rows = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    print(f"  sheet '{SHEET_WORK}': {raw_rows} rows -> {len(df)} after dropping exact duplicates")

    def col(*cands):
        for c in cands:
            for actual in df.columns:
                if actual.lower().startswith(c.lower()):
                    return actual
        return None

    C = {
        "ndc": col("National Drug Code"), "cid": col("Compound Identifier"),
        "name": col("Generic Name"), "l1": col("Level 1"), "l2": col("Level 2"),
        "l3": col("Level 3"), "l4": col("Level 4"), "atc": col("Anatomical Therapeutic Chemical"),
        "mw": col("Molecular Weight"), "logd": col("Lipophilicity"),
        "hbd": col("Hydrogen Bond Donors"), "hba": col("Hydrogen Bond Acceptors"),
        "tpsa": col("Topological Surface Area"), "rotb": col("Rotatable Bonds"),
        "arom": col("Aromatic Rings"), "hammett": col("Hammet"),
        "mrtaft": col("Molecular Refractivity"), "qed": col("Quantitative Estimate"),
        "mode": col("Mode of Administration"), "smiles": col("SMILES"),
        "target": col("Primary Biological Target"), "ivtox": col("In Vitro Toxicity"),
        "ivact": col("In Vitro Activity"), "ivvtox": col("In Vivo Toxicity"),
        "ivvact": col("In Vivo Activity"), "ti": col("Therapeutic Index"),
        "F": col("Bioavailability"), "t12": col("Half Life"), "dose": col("Dosage"),
        "tau": col("Dose Interval"), "fconc": col("In Vivo Free Drug Concentration"),
        "endpoint": col("Primary Toxicity Endpoint"),
    }
    missing = [k for k, v in C.items() if v is None]
    if missing:
        print(f"  ! columns not found in the sheet, left empty: {missing}")

    # the Excel formula string, taken from the sheet itself when it is there
    sheet_formula = ""
    if C["fconc"]:
        for v in df[C["fconc"]].dropna().astype(str):
            if v.strip().startswith("="):
                sheet_formula = v.strip()
                break
    if not sheet_formula:
        sheet_formula = "=(1.44*AA3*AB3*AC3/AD3)"

    drugs_json = {}
    admr_by_cid, admr_by_name, atc_names_curated, curated_smiles, titles = {}, {}, {}, {}, {}
    if os.path.exists(DRUGS_JSON):
        drugs_json = json.load(open(DRUGS_JSON, encoding="utf-8"))
        atc_names_curated = (drugs_json.get("meta") or {}).get("atc_names") or {}
        for d in (drugs_json.get("drugs") or []):
            cid = d.get("cid")
            per = {x["code"]: list(x.get("routes") or []) for x in (d.get("atc") or []) if x.get("code")}
            if cid is not None:
                admr_by_cid[int(cid)] = per
                curated_smiles[int(cid)] = d.get("smiles")
                titles[int(cid)] = d.get("title") or ""
            admr_by_name[norm_name(d.get("name"))] = per
        print(f"  data/drugs.json: {len(admr_by_cid)} drugs, "
              f"{sum(len(v) for v in admr_by_cid.values())} ATC entries, "
              f"{len(atc_names_curated)} ATC names")

    label_index = build_label_index(a.cache, a.rebuild_index)
    label_names = NameIndex((label_index.get("names") or {}).keys())
    db = build_drugbank_smiles(a.cache, a.rebuild_index)
    db_names = NameIndex((db.get("map") or {}).keys())
    pk_tables, pk_metas, pk_files = load_pk_tables()
    prior = load_prior_features()
    http = Http(a.cache, offline=a.offline)
    prov = Provenance()
    reach = {}

    # ---------------- probe the optional live sources once
    if not a.offline:
        st, _ = http.get(f"{PKDB}/")
        reach["pk_db_api_root"] = f"HTTP {st}"
        fj = http.json(f"{PKDB}/filter/?format=json&concise=true&interventions__substance=cimetidine")
        reach["pk_db_filter"] = (
            f"HTTP 200, cimetidine -> {fj.get('studies')} studies / {fj.get('interventions')} "
            f"interventions / {fj.get('outputs')} outputs" if isinstance(fj, dict)
            else "filter/ query failed")
        oj = http.json(f"{PKDB}/outputs/?format=json&page_size=1")
        reach["pk_db_outputs"] = (
            "reachable but unusable anonymously: /outputs/ returns count="
            f"{(((oj or {}).get('data') or {}) or {}).get('count')} even when the filter reports "
            "hundreds, so half-life and bioavailability need credentials this project does not have; "
            "dose and dose interval are taken from /interventions/ instead")
        st, _ = http.get(f"{CHEMBL}/status?format=json")
        reach["chembl"] = f"HTTP {st}"
        st, _ = http.get(WHO.format("A02BA"))
        reach["who_atc_ddd"] = f"HTTP {st}"
        st, _ = http.get(f"{OPENFDA}?search=openfda.generic_name:%22cimetidine%22&limit=1")
        reach["openfda"] = f"HTTP {st}"
        for k, v in reach.items():
            print(f"  probe {k}: {v}")
    else:
        reach["note"] = "--offline: no live source was contacted; cache and local files only"

    # ---------------- the row skeleton: (drug, ATC code)
    if a.atc4:
        g = a.atc4.strip().upper()
        df = df[df[C["atc"]].astype(str).str.upper().str.startswith(g)].reset_index(drop=True)
        print(f"  --atc4 {g}: {len(df)} (drug, ATC code) rows")
        if df.empty:
            sys.exit(f"no row in the sheet has an ATC code starting {g}")

    by_drug = defaultdict(list)
    order = []
    for _i, r in df.iterrows():
        cid = numeric(r.get(C["cid"])) if C["cid"] else None
        cid = int(cid) if cid is not None else None
        name = str(nz(r.get(C["name"])) or "").strip()
        atc = str(nz(r.get(C["atc"])) or "").strip().upper()
        if not name or not atc:
            continue
        key = (cid, name)
        if key not in by_drug:
            order.append(key)
        by_drug[key].append((atc, r))
    if a.limit:
        order = order[:a.limit]
        print(f"  --limit {a.limit}: {len(order)} drugs")
    print(f"  building {len(order)} drugs / {sum(len(by_drug[k]) for k in order)} (drug, ATC) pairs")

    # ---------------- WHO groups: level-4/5 names and the DDD per route
    groups = sorted({atc[:5] for k in order for atc, _ in by_drug[k] if len(atc) >= 5})
    who_ddd, who_names = {}, {}
    if groups:
        print(f"  WHO ATC/DDD index: {len(groups)} level-4 group pages "
              f"({'cache only' if a.offline else 'fetch + cache'})")
        for i, g in enumerate(groups, 1):
            members, url, ok = who_group(http, g)
            if ok:
                who_names.update(who_levels(http, g))
                for m in members:
                    who_names.setdefault(m["atc"], m["name"])
                    if m["ddd"]:
                        who_ddd[m["atc"]] = m["ddd"]
            if a.progress and i % max(1, a.progress) == 0:
                print(f"    {i}/{len(groups)} groups, {len(who_ddd)} with a DDD", flush=True)
        print(f"  WHO: {len(who_names)} ATC names, {len(who_ddd)} level-5 codes with a DDD")

    def atc_name(code):
        """A level name: the curated map first, then the WHO index, else empty."""
        if not code:
            return "", ""
        if code in atc_names_curated and atc_names_curated[code]:
            return atc_names_curated[code], "data/drugs.json meta.atc_names"
        if code in who_names and who_names[code]:
            return who_names[code], "WHO ATC/DDD index"
        return "", ""

    # ---------------- per drug
    rows = []
    feat_cache, smiles_cache = {}, {}
    counts = Counter()
    for di, key in enumerate(order, 1):
        cid, name = key
        nn = norm_name(name)
        pairs = by_drug[key]
        first_row = pairs[0][1]
        per_atc = (admr_by_cid.get(cid) if cid is not None else None) or admr_by_name.get(nn) or {}
        drug = {"cid": cid, "name": name, "_admr": per_atc}
        pk = pk_tables.get(nn) or {}
        pr = prior.get(nn) or {}

        # ---- SMILES: sheet, DrugBank, the curated parent, ChEMBL. PubChem is never asked.
        # The sources are tried in that order and each candidate is handed to RDKit before it is
        # accepted, so a structure RDKit rejects falls through to the next permitted source instead of
        # ending the drug with an unusable string: temoporfin's DrugBank record, for one, does not parse
        # while data/drugs.json holds a structure that does. Only if every candidate is rejected does the
        # row keep the first one, with that candidate's own RDKit diagnosis, so nothing is silently lost.
        if nn not in smiles_cache:
            cands = []
            sheet_smi = nz(first_row.get(C["smiles"])) if C["smiles"] else None
            if sheet_smi:
                cands.append((str(sheet_smi).strip(), "sheet: the workbook's own SMILES cell"))
            if db.get("available"):
                k, why = db_names.resolve(name)
                if k and (db["map"] or {}).get(k):
                    cands.append(((db["map"] or {})[k],
                                  f"drugbank: moldb_smiles for '{k}' in drugbank_drugs_info.csv ({why})"))
            if cid is not None and curated_smiles.get(cid):
                cands.append((curated_smiles[cid],
                              "curated: the parent SMILES for CID "
                              f"{cid} in data/drugs.json (ChEMBL/dataset-derived, not PubChem-normalised)"))

            def chembl_candidate():
                if a.offline:
                    return None
                q = urllib.parse.quote(name.replace(".", " "))
                js = http.json(f"{CHEMBL}/molecule/search?q={q}&format=json&limit=1")
                for m in ((js or {}).get("molecules") or []):
                    cs = ((m.get("molecule_structures") or {}) or {}).get("canonical_smiles")
                    if cs:
                        return (cs, f"chembl: canonical_smiles for {m.get('molecule_chembl_id')} "
                                    f"({CHEMBL}/molecule/search?q={q})")
                return None

            chosen, mol, ok, err = None, None, False, ""
            tried = []
            for i in range(len(cands) + 1):
                if i == len(cands):                      # ChEMBL is asked only if nothing else parsed
                    extra = chembl_candidate()
                    if extra is None:
                        break
                    cands.append(extra)
                cand_smi, cand_src = cands[i]
                cmol, cok, cerr = smiles_check(cand_smi)
                if cok:
                    note = ("" if not tried else
                            "; taken after RDKit rejected " +
                            ", ".join(f"the {t.split(':')[0]} structure ({e})" for t, e in tried))
                    chosen, mol, ok, err = (cand_smi, cand_src + note), cmol, True, ""
                    break
                tried.append((cand_src, cerr))
                if chosen is None:
                    chosen, err = (cand_smi, cand_src), cerr   # keep the first candidate and its error
            smi, src = chosen if chosen else ("", "")
            smiles_cache[nn] = {"smiles": smi or "", "source": src, "ok": ok, "error": err}
            feat_cache[nn] = rdkit_features(mol) if mol is not None else {}
        sm = smiles_cache[nn]
        feats = feat_cache[nn]
        counts["smiles_ok" if sm["ok"] else "smiles_bad"] += 1
        counts["smiles_src_" + (sm["source"].split(":")[0] or "none")] += 1

        # ---- the local label records, read once per drug
        lkey, lwhy = label_names.resolve(name)
        results = local_label_results(lkey, label_index) if lkey else []
        prose = label_prose(results) if results else ""
        lsrc = (f"local openFDA drug/label.json cache for '{lkey}' ({lwhy}); files "
                f"{', '.join(sorted({b for b, _ in results})[:3])}") if results else ""
        if not prose and not a.offline:
            for spelling, note in openfda_query_names(name):
                q = urllib.parse.quote(f'openfda.generic_name:"{spelling}"')
                url = f"{OPENFDA}?search={q}&limit=25"
                js = http.json(url)
                live = [("live", r) for r in ((js or {}).get("results") or [])]
                if live:
                    results, prose = live, label_prose(live)
                    lsrc = f"openFDA drug/label.json{note} ({url})"
                    break
            counts["label_live" if prose else "label_none"] += 1
        elif prose:
            counts["label_local"] += 1
        else:
            counts["label_none"] += 1

        # ---- the PK/tox cells that do not depend on the route
        F = from_table(pk, "F", "fraction")
        t12 = from_table(pk, "half_life_h", "h")
        dose = from_table(pk, "dose_mg", "mg")
        tau = from_table(pk, "dose_interval_h", "h")
        act = from_table(pk, "invivo_act")
        tox = from_table(pk, "invivo_tox")
        if pr:
            for c, k in ((F, "Bioavailability(Fraction Absorbed)"), (t12, "Half Life"),
                         (dose, "Dosage"), (tau, "Dose Interval")):
                if not has(c):
                    v = numeric(pr.get(k))
                    if v is not None:
                        c.update({"value": v,
                                  "source": f"earlier run of this group: {os.path.basename(PRIOR_FEATURES)}",
                                  "quote": f"{k} = {pr.get(k)} (reused, not re-derived)"})
        dose_prose, tau_prose = EMPTY, EMPTY
        # ---- PK-DB: literature dosing per route. Dose and interval only; the PK parameter tables
        # (half-life, bioavailability) are not public, so those still come from the label prose.
        pkdb = {}
        if not a.offline and not (has(dose) and has(tau)):
            try:
                pkdb, _iurl, n_int = pkdb_doses(http, name, legend)
            except Exception as exc:                       # noqa: BLE001 - one lookup never kills a run
                pkdb, n_int = {}, -1
                counts["pkdb_error"] += 1
                prov.note(name, "", "", "pkdb", f"PK-DB lookup raised {type(exc).__name__}: {exc}",
                          retrieved)
            counts["pkdb_hit" if pkdb else ("pkdb_error" if n_int < 0 else "pkdb_absent")] += 1
            if not pkdb and n_int == 0:
                prov.note(name, "", "", "pkdb",
                          "PK-DB has no intervention for this substance "
                          "(filter/?interventions__substance returns 0); treated as a real absence",
                          retrieved)

        if prose:
            if not has(F):
                F = read_bioavailability(prose, lsrc) or F
            if not has(t12):
                t12 = read_half_life(prose, lsrc) or t12
            if not has(dose) or not has(tau):
                # kept separate, not merged into dose/tau: the per-row order is PK-DB, then the WHO
                # DDD for this row's route, and only then a sentence out of the label.
                dose_prose, tau_prose = read_dose(prose, lsrc)
            if not has(tox):
                tox = read_lethal_dose(prose, lsrc) or tox
        endpoint = EMPTY
        if nz(first_row.get(C["endpoint"])) if C["endpoint"] else None:
            endpoint = cell(nz(first_row.get(C["endpoint"])), "sheet", "the workbook's own cell")
        elif results:
            endpoint = read_endpoint(results, lsrc)
        for nm_, c in (("bioavailability_F", F), ("half_life_h", t12), ("dose_mg", dose),
                       ("dose_interval_h", tau), ("in_vivo_activity", act),
                       ("in_vivo_toxicity", tox), ("primary_toxicity_endpoint", endpoint)):
            if has(c):
                counts["filled_" + nm_] += 1

        # ---- one row per (drug, ATC code, mode)
        for atc, r in pairs:
            modes = resolve_modes(drug, atc, legend, label_index, label_names, http, prov,
                                  a.offline, retrieved)
            counts["atc_pairs"] += 1
            for m in modes:
                counts["mode_" + m["source"]] += 1
            nmodes = len(modes)
            for rank, m in enumerate(modes, 1):
                e = m["entry"]
                short = e["short"]
                notes = []

                # in-vivo activity: the WHO defined daily dose for THIS route, as build_cohort.py does
                ddd = (who_ddd.get(atc) or {})
                dd = ddd.get(e["name"]) or ddd.get(short)
                sub = ""
                if dd is None and short in PARENTERAL_KIN and ddd.get("PARENTERAL"):
                    dd = ddd["PARENTERAL"]
                    sub = (" (the WHO index gives this DDD for parenteral administration 'P'; this row's"
                           f" route {short} is a parenteral sub-route the FDA legend keeps separate)")
                row_act = act
                if not has(row_act) and dd:
                    row_act = cell(dd["mg"], f"WHO ATC/DDD index defined daily dose ({dd['url']})",
                                   f"DDD for {atc} printed as '{dd['printed']}'{sub}",
                                   unit="mg", kind="WHO defined daily dose")
                if not has(row_act):
                    notes.append("no in-vivo activity dose: the WHO index prints no DDD for this ATC "
                                 "code and route, and no curated or label value was found")

                # dose and interval, in the brief's source order: the user's curated table and the
                # earlier runs of this group, then PK-DB for this route, then the WHO DDD for this
                # route, then a sentence out of the label.
                pk_route = pkdb.get(e["name"]) or {}
                row_dose, row_tau = dose, tau
                if not has(row_dose) and has(pk_route.get("dose")):
                    row_dose = pk_route["dose"]
                if not has(row_tau) and has(pk_route.get("tau")):
                    row_tau = pk_route["tau"]
                if not has(row_dose) and dd:
                    row_dose = cell(dd["mg"], f"WHO ATC/DDD index defined daily dose ({dd['url']})",
                                    f"DDD for {atc} printed as '{dd['printed']}'{sub}", unit="mg")
                if not has(row_tau) and dd:
                    row_tau = cell(DDD_INTERVAL_H, f"WHO ATC/DDD index ({dd['url']})",
                                   "a defined daily dose is one day's maintenance dose", unit="h")
                if not has(row_dose) and has(dose_prose):
                    row_dose = dose_prose
                if not has(row_tau) and has(tau_prose):
                    row_tau = tau_prose

                Fv, t12v = F.get("value"), t12.get("value")
                dv, tv = row_dose.get("value"), row_tau.get("value")
                fc = free_concentration(Fv, t12v, dv, tv)
                if fc is None:
                    gaps = [n for n, v in (("F", Fv), ("half-life", t12v), ("dose", dv),
                                           ("dose interval", tv)) if v is None]
                    if gaps:
                        notes.append("no free drug concentration: " + ", ".join(gaps) + " not established")

                tv_tox = tox.get("value")
                use_ti = tox.get("use_in_ti", True) if has(tox) else False
                ti = tic = None
                basis = ""
                if has(tox) and has(row_act):
                    if use_ti:
                        ti = therapeutic_index(tv_tox, row_act["value"])
                        tic = therapeutic_index_classical(tv_tox, row_act["value"])
                        basis = (f"{tox.get('kind') or 'toxicity'} "
                                 f"{tv_tox} {tox.get('unit') or ''}".strip()
                                 + (f" ({tox.get('species')}" if tox.get("species") else "")
                                 + (f", {tox.get('route')})" if tox.get("route") else
                                    (")" if tox.get("species") else ""))
                                 + f" against {row_act['value']} {row_act.get('unit') or ''}"
                                   f" {row_act.get('kind') or 'in-vivo activity'}")
                    else:
                        basis = (f"not computed: the toxicity value is a "
                                 f"{tox.get('kind') or 'non-lethal endpoint'}, which the curated table "
                                 f"marks as not usable in a therapeutic index")
                        notes.append(basis)
                elif not has(tox):
                    notes.append("no therapeutic index: no in-vivo toxicity dose established")

                rec = {c: "" for c in ALL_COLS}
                rec.update({
                    "row_id": f"{cid if cid is not None else 'NA'}|{atc}|{short}",
                    "cid": cid if cid is not None else "",
                    "generic_name": name,
                    "drug_title": titles.get(cid, "") if cid is not None else "",
                    "national_drug_code": nz(r.get(C["ndc"])) or "" if C["ndc"] else "",
                    "inchikey": (Chem.MolToInchiKey(Chem.MolFromSmiles(sm["smiles"]))
                                 if sm["ok"] and sm["smiles"] else ""),
                    "atc_code": atc,
                    "atc_l1": atc[:1], "atc_l2": atc[:3], "atc_l3": atc[:4],
                    "atc_l4": atc[:5], "atc_l5": atc,
                    "sheet_level1_anatomical": nz(r.get(C["l1"])) or "" if C["l1"] else "",
                    "sheet_level2_therapeutic": nz(r.get(C["l2"])) or "" if C["l2"] else "",
                    "sheet_level3_mechanism": nz(r.get(C["l3"])) or "" if C["l3"] else "",
                    "sheet_level4_chemical_group": nz(r.get(C["l4"])) or "" if C["l4"] else "",
                    "mode_of_administration": short,
                    "mode_name": e["name"], "mode_fda_code": e["fda_code"],
                    "mode_nci_concept_id": e["nci"], "mode_definition": e["definition"],
                    "mode_source": m["source"], "mode_evidence": m["evidence"],
                    "mode_raw": m["raw"], "mode_rank": rank, "n_modes": nmodes,
                    "has_multiple_modes": "true" if nmodes > 1 else "false",
                    "smiles": sm["smiles"], "smiles_source": sm["source"],
                    "smiles_ok": "true" if sm["ok"] else "false", "smiles_error": sm["error"],
                    "sheet_smiles": nz(r.get(C["smiles"])) or "" if C["smiles"] else "",
                    "free_conc": "" if fc is None else fc,
                    "free_conc_formula": sheet_formula,
                    "free_conc_basis": ("1.44 * F * half-life(h) * dose(mg) / interval(h)"
                                        if fc is not None else ""),
                    "therapeutic_index": "" if ti is None else ti,
                    "therapeutic_index_classical": "" if tic is None else tic,
                    "therapeutic_index_basis": basis,
                    "dose_corrected_bioavailability":
                        "" if dose_corrected_bioavailability(Fv, dv) is None
                        else dose_corrected_bioavailability(Fv, dv),
                    "who_ddd_mg": dd["mg"] if dd else "",
                    "who_ddd_printed": (dd["printed"] + sub) if dd else "",
                })
                for lv, cd in (("atc_l1_name", atc[:1]), ("atc_l2_name", atc[:3]),
                               ("atc_l3_name", atc[:4]), ("atc_l4_name", atc[:5]),
                               ("atc_l5_name", atc)):
                    nmv, nsrc = atc_name(cd)
                    rec[lv] = nmv
                    if nsrc:
                        rec["atc_name_source"] = nsrc
                for k_, v_ in feats.items():
                    if k_ in rec:
                        rec[k_] = v_
                rec["features_source"] = ("RDKit 2026.09.1 on the SMILES in this row "
                                          "(QED.properties for the eight component terms and ALERTS, "
                                          "QED.qed for the composite, Crippen.MolMR for the Hansch MR)"
                                          if feats else "no valid structure, so nothing was computed")
                for dst, sc in (("sheet_molecular_weight", "mw"), ("sheet_lipophilicity_logd", "logd"),
                                ("sheet_hydrogen_bond_donors", "hbd"),
                                ("sheet_hydrogen_bond_acceptors", "hba"),
                                ("sheet_topological_surface_area", "tpsa"),
                                ("sheet_rotatable_bonds", "rotb"), ("sheet_aromatic_rings", "arom"),
                                ("sheet_hammett_substituent_constant", "hammett"),
                                ("sheet_molecular_refractivity_or_taft", "mrtaft"),
                                ("sheet_qed", "qed"), ("sheet_mode_of_administration", "mode"),
                                ("sheet_primary_biological_target", "target"),
                                ("sheet_in_vitro_toxicity", "ivtox"),
                                ("sheet_in_vitro_activity", "ivact"),
                                ("sheet_in_vivo_toxicity", "ivvtox"),
                                ("sheet_in_vivo_activity", "ivvact"),
                                ("sheet_therapeutic_index", "ti"), ("sheet_bioavailability", "F"),
                                ("sheet_half_life", "t12"), ("sheet_dosage", "dose"),
                                ("sheet_dose_interval", "tau"),
                                ("sheet_in_vivo_free_drug_concentration", "fconc"),
                                ("sheet_primary_toxicity_endpoint", "endpoint")):
                    rec[dst] = (nz(r.get(C[sc])) or "") if C.get(sc) else ""
                rec.update({
                    "bioavailability_F": "" if F.get("value") is None else F["value"],
                    "bioavailability_source": F.get("source", ""),
                    "bioavailability_quote": F.get("quote", ""),
                    "half_life_h": "" if t12.get("value") is None else t12["value"],
                    "half_life_source": t12.get("source", ""),
                    "half_life_quote": t12.get("quote", ""),
                    "dose_mg": "" if row_dose.get("value") is None else row_dose["value"],
                    "dose_mg_source": row_dose.get("source", ""),
                    "dose_mg_quote": row_dose.get("quote", ""),
                    "dose_interval_h": "" if row_tau.get("value") is None else row_tau["value"],
                    "dose_interval_source": row_tau.get("source", ""),
                    "dose_interval_quote": row_tau.get("quote", ""),
                    "in_vivo_activity": "" if row_act.get("value") is None else row_act["value"],
                    "in_vivo_activity_unit": row_act.get("unit", ""),
                    "in_vivo_activity_kind": row_act.get("kind", ""),
                    "in_vivo_activity_source": row_act.get("source", ""),
                    "in_vivo_activity_quote": row_act.get("quote", ""),
                    "in_vivo_toxicity": "" if tox.get("value") is None else tox["value"],
                    "in_vivo_toxicity_unit": tox.get("unit", ""),
                    "tox_dose_kind": tox.get("kind", ""),
                    "tox_species": tox.get("species", ""),
                    "tox_route": tox.get("route", ""),
                    "tox_bound": tox.get("bound", ""),
                    "tox_use_in_ti": ("" if not has(tox) else ("true" if use_ti else "false")),
                    "in_vivo_toxicity_source": tox.get("source", ""),
                    "in_vivo_toxicity_quote": tox.get("quote", ""),
                    "in_vitro_activity": (nz(pr.get("In Vitro Activity")) or "") if pr else "",
                    "in_vitro_toxicity":
                        (nz(pr.get("In Vitro Toxicity(Binding affinity to Off Target)")) or "")
                        if pr else "",
                    "primary_biological_target":
                        (nz(r.get(C["target"])) if C["target"] else None)
                        or (nz(pr.get("Primary Biological Target")) if pr else None) or "",
                    "primary_toxicity_endpoint":
                        "" if endpoint.get("value") is None else endpoint["value"],
                    "primary_toxicity_endpoint_source": endpoint.get("source", ""),
                    "fill_note": " | ".join(notes),
                })
                rows.append(rec)

                # ---- provenance: one row per sourced value, plus a reason for each notable empty
                prov.add(name, atc, short, "mode_of_administration",
                         cell(short, m["evidence"], m["evidence"]),
                         "found" if m["source"] != "not_applicable" else "not_established", retrieved)
                prov.add(name, atc, short, "smiles",
                         cell(sm["smiles"] or None, sm["source"], sm["source"]),
                         "found" if sm["smiles"] else "not_established", retrieved)
                if not sm["ok"]:
                    prov.note(name, atc, short, "smiles_valid", sm["error"], retrieved)
                if feats:
                    prov.add(name, atc, short, "qed",
                             cell(feats["qed"], rec["features_source"],
                                  "RDKit QED.qed on the row's SMILES"), "found", retrieved)
                for fld, c in (("bioavailability_F", F), ("half_life_h", t12),
                               ("dose_mg", row_dose), ("dose_interval_h", row_tau),
                               ("in_vivo_activity", row_act), ("in_vivo_toxicity", tox),
                               ("primary_toxicity_endpoint", endpoint)):
                    if has(c):
                        prov.add(name, atc, short, fld, c, "found", retrieved)
                    else:
                        prov.note(name, atc, short, fld,
                                  "not established by any permitted source for this (drug, ATC, mode)",
                                  retrieved)
                for fld, v, why_ in (("free_conc", fc, "needs F, half-life, dose and dose interval"),
                                     ("therapeutic_index", ti,
                                      "needs an in-vivo toxicity dose usable in an index and an "
                                      "in-vivo activity dose")):
                    if v is not None:
                        prov.add(name, atc, short, fld,
                                 cell(v, "computed from this row's sourced inputs",
                                      rec["free_conc_basis"] if fld == "free_conc" else basis),
                                 "inferred", retrieved)
                    else:
                        prov.note(name, atc, short, fld, why_, retrieved)

        if a.progress and di % max(1, a.progress) == 0:
            print(f"    {di}/{len(order)} drugs, {len(rows)} rows, {time.time() - t0:.0f}s",
                  flush=True)

    # ---------------- deterministic order
    rows.sort(key=lambda x: (str(x["generic_name"]), str(x["atc_code"]), int(x["mode_rank"]),
                             str(x["mode_of_administration"])))
    prov.rows.sort(key=lambda x: (str(x["compound"]), str(x["atc_code"]),
                                  str(x["mode_of_administration"]), str(x["field"])))

    # ---------------- write
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=ALL_COLS, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    with open(a.prov, "w", encoding="utf-8", newline="") as f:
        pf = ["compound", "atc_code", "mode_of_administration", "field", "value", "unit",
              "source", "source_url", "quote", "retrieved_at", "status"]
        w = csv.DictWriter(f, fieldnames=pf, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(prov.rows)

    # the compact JSON: short keys, codes only, names and the legend in meta
    used_codes = set()
    for x in rows:
        for k in ("atc_l1", "atc_l2", "atc_l3", "atc_l4", "atc_code"):
            if x[k]:
                used_codes.add(x[k])
    jrows = []
    for x in rows:
        out = []
        for short, src in JSON_COLS:
            v = x.get(src, "")
            if v == "" or v is None:
                out.append(None)
            elif src in NUM_FIELDS:
                out.append(r3(numeric(v), WIDE_FIELDS.get(src, FLOAT3)))
            elif src == "has_multiple_modes":
                out.append(v == "true")
            elif src == "smiles_ok":
                out.append(v == "true")
            elif src in ("hba", "hbd", "rotb", "arom", "alerts", "heavy_atoms", "n_modes", "cid"):
                n = numeric(v)
                out.append(None if n is None else int(n))
            else:
                out.append(v)
        jrows.append(out)
    names_map = {}
    for c in sorted(used_codes):
        n, _s = atc_name(c)
        if n:
            names_map[c] = n
    modes_used = sorted({x["mode_of_administration"] for x in rows})
    compact = {
        "meta": {
            "generated_utc": retrieved,
            "generator": "tools/curate_dataset.py",
            "source_workbook": os.path.basename(a.src),
            "source_sheet": SHEET_WORK,
            "sheet_rows_raw": raw_rows,
            "sheet_rows_deduped": int(len(df)),
            "n_rows": len(rows),
            "n_drugs": len({x["generic_name"] for x in rows}),
            "n_atc_pairs": len({(x["generic_name"], x["atc_code"]) for x in rows}),
            "grain": "one row per (drug, ATC code, mode of administration)",
            "mode_rule": ("WHO ATC/DDD AdmR first; a US label route only when AdmR is empty; a DailyMed "
                          "dosage-form inference only when there is no label route; otherwise the FDA "
                          "legend's NOT APPLICABLE entry. Every mode is mapped to the FDA route legend, "
                          "and no route is ever re-mapped onto a different legend route."),
            "smiles_rule": ("sheet, then drugbank_drugs_info.csv moldb_smiles, then the curated parent "
                            "in data/drugs.json, then ChEMBL, each validated with RDKit before it is "
                            "accepted and falling through to the next source when RDKit rejects it. "
                            "PubChem is never used for SMILES because "
                            "its SMILES cannot distinguish tautomers or isomers."),
            "formulas": {
                "free_conc": "1.44 * F * half_life_h * dose_mg / dose_interval_h",
                "free_conc_excel": sheet_formula,
                "therapeutic_index": "log10(in_vivo_toxicity) - log10(1 / in_vivo_activity)",
                "therapeutic_index_classical": "log10(in_vivo_toxicity / in_vivo_activity)",
                "dose_corrected_bioavailability": "F / dose_mg",
            },
            "mode_source_counts": {k[5:]: v for k, v in sorted(counts.items())
                                   if k.startswith("mode_")},
            "atc_names": names_map,
            "atc_name_levels": {"l1": 1, "l2": 3, "l3": 4, "l4": 5, "l5": 7},
            "routes": {s: [legend.by_short[s]["name"], legend.by_short[s]["fda_code"],
                           legend.by_short[s]["nci"]]
                       for s in modes_used if s in legend.by_short},
            "reachability": reach,
            "pk_table_files": [os.path.basename(p) for p in pk_files],
            "pk_table_warnings": [m.get("warning") for m in pk_metas if m.get("warning")],
            "full_table": "data/clean_drugs.csv",
            "provenance": "data/clean_provenance.csv",
        },
        "cols": [s for s, _ in JSON_COLS],
        "rows": jrows,
    }
    jpath = a.json_out or json_out
    with open(jpath, "w", encoding="utf-8") as f:
        json.dump(compact, f, separators=(",", ":"), sort_keys=False, ensure_ascii=False)
        f.write("\n")

    # ---------------- summary
    def size(p):
        n = os.path.getsize(p)
        return f"{n:,} B ({n / 1024:.0f} KiB)"

    gz = len(gzip.compress(open(jpath, "rb").read(), 9))
    print("\n" + "=" * 78)
    print(f"rows {len(rows)} | drugs {len({x['generic_name'] for x in rows})} | "
          f"(drug,ATC) pairs {counts['atc_pairs']} | provenance rows {len(prov.rows)}")
    print(f"  {a.out}  {size(a.out)}")
    print(f"  {jpath}  {size(jpath)}  gzip {gz:,} B ({gz / 1024:.0f} KiB)"
          + ("  !! over the 120 KiB budget" if gz > 120 * 1024 else "  within the 120 KiB budget"))
    print(f"  {a.prov}  {size(a.prov)}")
    print("\nmodes by branch:")
    for k, v in sorted(counts.items()):
        if k.startswith("mode_"):
            print(f"  {k[5:]:<28} {v}")
    print("\nSMILES:")
    print(f"  valid {counts['smiles_ok']} | invalid {counts['smiles_bad']}")
    for k, v in sorted(counts.items()):
        if k.startswith("smiles_src_"):
            print(f"  source {k[11:]:<22} {v}")
    print("\nUS label coverage (one count per drug):")
    print(f"  from the local openFDA/DailyMed cache   {counts['label_local']}")
    print(f"  from a live openFDA query               {counts['label_live']}")
    print(f"  no US label found at all                {counts['label_none']}")
    print("\nfill rate per column (non-empty rows):")
    for c in ("mode_of_administration", "mode_nci_concept_id", "smiles", "qed", "mw", "alogp",
              "molmr", "alerts", "bioavailability_F", "half_life_h", "dose_mg", "dose_interval_h",
              "in_vivo_activity", "in_vivo_toxicity", "who_ddd_mg", "free_conc",
              "therapeutic_index", "therapeutic_index_classical",
              "dose_corrected_bioavailability", "primary_toxicity_endpoint",
              "atc_l4_name", "atc_l5_name"):
        n = sum(1 for x in rows if str(x.get(c, "")) != "")
        print(f"  {c:<34} {n:>5} / {len(rows)}  {100.0 * n / max(1, len(rows)):5.1f}%")
    print(f"\nHTTP: {dict(http.stats)}")
    print(f"elapsed {time.time() - t0:.0f}s")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
