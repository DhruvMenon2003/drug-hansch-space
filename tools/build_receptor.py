#!/usr/bin/env python3
"""Real H2-receptor coordinates for the binding animation on site/receptor/: two cryo-EM states, superposed.

Fetches four files from RCSB (PDB data is CC0, no licence problem), parses them, superposes the two
receptor states on their transmembrane bundle and writes site/receptor/data/h2r.json.

    tools/build_receptor.py                        # fetch (disk-cached), then write the file
    tools/build_receptor.py --check                # no network: rebuild from the cache and exit 1 unless the
                                                   # bytes on disk are identical to what a run would write
    tools/build_receptor.py --report               # also print the derivation to stderr (helix ranges, RMSD, TM6 swing)
    tools/build_receptor.py --cache DIR --out FILE # other paths

THE STATES
    inactive  7UL3 chain A, ligand HETATM residue FO9 (famotidine).  Chains C/H/L (nanobody Nb6M +
              NabFab scaffold) are read only to locate the cytoplasmic face, never emitted.
    active    8YN3 chain R, ligand HETATM residue HSM (histamine).   Chains A/B/C/N (miniGs + Nb35) are
              read only to locate the cytoplasmic face; CLR (cholesterol) is dropped.

THE ONE RULE: nothing in the output is remembered, estimated or assumed. Every string and every number is
parsed from one of the four fetched files or computed from their coordinates, and meta.sources records the
URL, the byte count, the sha256 and the fetch time of each. Anything this script cannot determine from the
files goes in meta.gaps with the reason instead of being filled in.

NOTHING HERE IS DERIVED FROM MEMORY, IN PARTICULAR NOT THE HELIX BOUNDARIES. The seven transmembrane
helices are found like this, and meta.tm_derivation says so in the file itself:
  1. a residue is helical if a HELIX record of that chain covers it;
  2. the membrane normal is the sign-aligned mean of the local helix axis of every helical residue
     (CA(i+3) - CA(i-3)), iterated to a fixed point - the TM bundle dominates it, H8 and the surface
     helices are too few to turn it;
  3. a helical residue is axial when its local axis is within 55 deg of that normal, which keeps the
     bundle and drops H8 and the ICL2 surface helix, both of which lie across the membrane;
  4. maximal runs of axial residues (bridging breaks of up to 2 residues, e.g. the kink inside TM3) that
     span at least 25 A along the normal are transmembrane. Seven survive in each structure, and they are
     numbered TM1..TM7 in sequence order. Every run that was rejected is listed with its measurements.

7UL3 CHAIN A IS A CHIMERA AND THE SCRIPT REFUSES TO PRETEND OTHERWISE. Its own DBREF records say residues
1-199 and 246-359 are UNP P25021 (HRH2_HUMAN) while 202-245 are UNP A0A8B8VNB6_BALMU, with 200-201 marked
LINKER by SEQADV. So residue 230 of 7UL3 and residue 230 of 8YN3 are not the same residue. Residues in that
declared window are excluded from the superposition; the observed residue types confirm the window
(every one of the 36 same-number-different-residue pairs falls inside it and none outside). They are still
offered for the morph, flagged "diff", because the backbone positions are positionally equivalent along the
same helix even where the side chain is not the same.

Deterministic and idempotent: responses are cached on disk so reruns are offline, there is no wall-clock
reading anywhere in the output (provenance is each source's cached retrieved_utc plus its sha256), floats
are rounded, key order is fixed, and the file is only rewritten when its bytes would change. meta.numpy
records the numpy version, because the superposition belongs to it.

site/receptor/ fetches this file lazily on its own. The main app (site/index.html, site/js/**) must never
request it: its boot request budget and its first-load data budget are both full.

Python 3 standard library plus numpy (Kabsch). No rdkit: the ligand bond orders come from the RCSB
chemical component dictionary, not from a perception algorithm.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(ROOT, "site", "receptor", "data", "h2r.json")
DEFAULT_CACHE = os.path.join(ROOT, ".pdb_cache")
UA = "drug-hansch-space/build_receptor.py (+https://github.com/DhruvMenon2003/drug-hansch-space)"
PDB_URL = "https://files.rcsb.org/download/{}.pdb"
LIG_URL = "https://files.rcsb.org/ligands/download/{}.cif"
LICENCE = ("RCSB PDB", "CC0 1.0 Universal (PDB data are in the public domain)", "https://www.rcsb.org/pages/usage-policy")

# The two states. Chain and het code are asserted against the files, never assumed: see check_expected().
STATES = [
    {"key": "inactive", "pdb": "7UL3", "chain": "A", "het": "FO9", "n_ca": 268, "n_lig": 20,
     "drop_chains": "C, H, L (nanobody Nb6M and the NabFab scaffold)"},
    {"key": "active", "pdb": "8YN3", "chain": "R", "het": "HSM", "n_ca": 280, "n_lig": 8,
     "drop_chains": "A, B, C, N (miniGs heterotrimer and nanobody Nb35)"},
]
REFERENCE = "active"        # the common frame is this state's own frame, then recentred on the bundle

AA3 = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G",
       "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S",
       "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V", "MSE": "M", "SEC": "U", "PYL": "O"}
Z = {"H": 1, "HE": 2, "LI": 3, "BE": 4, "B": 5, "C": 6, "N": 7, "O": 8, "F": 9, "NE": 10, "NA": 11,
     "MG": 12, "AL": 13, "SI": 14, "P": 15, "S": 16, "CL": 17, "AR": 18, "K": 19, "CA": 20, "MN": 25,
     "FE": 26, "CO": 27, "NI": 28, "CU": 29, "ZN": 30, "AS": 33, "SE": 34, "BR": 35, "MO": 42, "RU": 44,
     "AG": 47, "CD": 48, "I": 53, "W": 74, "PT": 78, "AU": 79, "HG": 80}
# Bond order as site/data/mol/*.json encodes it (tools/build_data.py: 4 means aromatic, see its molecule()).
ORDER = {"SING": 1, "DOUB": 2, "TRIP": 3, "QUAD": 4}
AROMATIC = 4

MONTHS = {"JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
          "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12"}

AXIAL_WINDOW = 3            # local helix axis is CA(i+3) - CA(i-3): one turn either side
AXIAL_DEGREES = 55.0        # a helical residue is axial when its local axis is within this of the normal
BRIDGE = 2                  # axial runs are joined across breaks no longer than this many residues
TM_SPAN = 25.0              # an axial run is transmembrane when it spans at least this far along the normal
TM6_END_RESIDUES = 4        # the cytoplasmic end of TM6 is the centroid of this many CA atoms


# --------------------------------------------------------------------------------------------------- fetch

def _utc(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


class Fetcher:
    """GET with a disk cache and a per-host delay. offline=True never touches the network."""

    MIN_INTERVAL = {"files.rcsb.org": 1.0}

    def __init__(self, cache_dir, offline=False):
        self.cache_dir, self.offline = cache_dir, offline
        self.log, self._last = {}, {}
        if not offline:
            os.makedirs(cache_dir, exist_ok=True)

    def _path(self, url):
        return os.path.join(self.cache_dir, hashlib.sha256(url.encode()).hexdigest()[:40] + ".json")

    def get(self, url, purpose=""):
        """Return the body text. Caches the whole response, so a rerun needs no network at all."""
        path = self._path(url)
        entry = None
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                entry = json.load(f)
        if entry is None:
            if self.offline:
                raise SystemExit(f"--check is offline and {url} is not in the cache {self.cache_dir}; "
                                 f"run tools/build_receptor.py without --check first")
            host = urllib.parse.urlsplit(url).netloc
            gap = self.MIN_INTERVAL.get(host, 1.0)
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
                    if status == 404 or attempt == 2:
                        break
                    time.sleep(2 + 3 * attempt)
                except (urllib.error.URLError, OSError, TimeoutError) as e:
                    status, body = -1, f"{type(e).__name__}: {e}"
                    if attempt == 2:
                        break
                    time.sleep(2 + 3 * attempt)
            self._last[host] = time.monotonic()
            if status != 200:
                raise SystemExit(f"{url} -> HTTP {status}: {body[:200]}")
            entry = {"url": url, "status": status, "retrieved_utc": _utc(time.time()), "body": body}
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(entry, f)
            os.replace(tmp, path)
        if entry["status"] != 200:
            raise SystemExit(f"cached {url} -> HTTP {entry['status']}; delete {path} and rerun")
        raw = entry["body"].encode("utf-8")
        self.log[url] = {"url": url, "source": LICENCE[0], "licence": LICENCE[1],
                         "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                         "retrieved_utc": entry["retrieved_utc"], "purpose": purpose}
        return entry["body"]


# --------------------------------------------------------------------------------------------------- parse

def parse_pdb(text):
    """The records this script needs out of one PDB file. Columns are the PDB format's fixed columns."""
    out = {"header": "", "deposited": None, "title": "", "method": "", "resolution": None,
           "ca": {}, "het": {}, "helix": [], "dbref": [], "seqadv": {}, "hetnam": {}, "formul": {},
           "het_counts": {}, "conect": {}, "serial_atom": {}, "other_ca": {}, "models": 0}
    title, expdta = [], []
    for line in text.splitlines():
        rec = line[:6]
        if rec == "HEADER":
            out["header"] = line[10:50].strip()
            d = line[50:59].strip()                              # DD-MMM-YY
            m = re.fullmatch(r"(\d{2})-([A-Z]{3})-(\d{2})", d)
            if m and m.group(2) in MONTHS:                       # PDB began in 1971, so 71-99 is 19xx
                yy = int(m.group(3))
                out["deposited"] = f"{1900 + yy if yy >= 71 else 2000 + yy}-{MONTHS[m.group(2)]}-{m.group(1)}"
            else:
                out["deposited"] = None
        elif rec == "TITLE ":
            title.append(line[10:80].rstrip())
        elif rec == "EXPDTA":
            expdta.append(line[10:79].strip())
        elif rec == "REMARK" and line[6:10].strip() == "2" and "RESOLUTION." in line:
            m = re.search(r"RESOLUTION\.\s+([0-9.]+)\s+ANGSTROM", line)
            if m:
                out["resolution"] = float(m.group(1))
        elif rec == "MODEL ":
            out["models"] += 1
        elif rec == "HELIX ":
            if line[19] == line[31]:                             # single-chain helix only
                out["helix"].append({"chain": line[19], "start": int(line[21:25]), "end": int(line[33:37]),
                                     "class": line[38:40].strip(), "id": line[11:14].strip()})
        elif rec in ("DBREF ", "DBREF1", "DBREF2"):
            out["dbref"].append(line.rstrip())
        elif rec == "SEQADV":
            out["seqadv"].setdefault(line[16], {})[int(line[18:22])] = line[49:70].strip()
        elif rec == "HETNAM":
            out["hetnam"].setdefault(line[11:14].strip(), "")
            out["hetnam"][line[11:14].strip()] += line[15:70].strip()
        elif rec == "FORMUL":
            out["formul"].setdefault(line[12:15].strip(), "")
            out["formul"][line[12:15].strip()] += line[19:70].rstrip()
        elif rec == "HET   ":
            out["het_counts"][line[7:10].strip()] = int(line[20:25])
        elif rec == "CONECT":
            a = int(line[6:11])
            out["conect"].setdefault(a, set()).update(
                int(line[i:i + 5]) for i in (11, 16, 21, 26) if line[i:i + 5].strip())
        elif rec in ("ATOM  ", "HETATM"):
            alt, name, resn, chain = line[16], line[12:16].strip(), line[17:20].strip(), line[21]
            icode, serial = line[26], int(line[6:11])
            if alt not in (" ", "A"):                            # keep one conformation only
                continue
            xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
            element = (line[76:78].strip() or name[:1]).upper()
            if rec == "ATOM  " and name == "CA" and resn in AA3:
                key = (chain, int(line[22:26]), icode)
                out["ca"][key] = {"resn": resn, "xyz": xyz}
                out["other_ca"].setdefault(chain, []).append(xyz)
            elif rec == "HETATM":
                out["het"].setdefault(resn, []).append(
                    {"chain": chain, "seq": line[22:26].strip(), "icode": icode, "name": name,
                     "element": element, "xyz": xyz, "serial": serial})
                out["serial_atom"][serial] = (resn, name)
    out["title"] = re.sub(r"\s+", " ", " ".join(t for t in title if t)).strip()
    out["method"] = "; ".join(e for e in expdta if e)
    for d in (out["hetnam"], out["formul"]):
        for k in d:
            d[k] = re.sub(r"\s+", " ", d[k]).strip()
    return out


def cif_tokens(text):
    """mmCIF tokens of one line, honouring single and double quotes."""
    for raw in text.splitlines():
        line = raw.rstrip("\n")
        if line.startswith("#"):
            yield ["#"]
            continue
        toks, i = [], 0
        while i < len(line):
            if line[i] in " \t":
                i += 1
                continue
            if line[i] in "'\"":
                q = line[i]
                j = i + 1
                while j < len(line) and not (line[j] == q and (j + 1 == len(line) or line[j + 1] in " \t")):
                    j += 1
                toks.append(line[i + 1:j])
                i = j + 1
            else:
                j = i
                while j < len(line) and line[j] not in " \t":
                    j += 1
                toks.append(line[i:j])
                i = j
        if toks:
            yield toks


def parse_ccd(text):
    """One RCSB chemical-component-dictionary entry: its name, formula, atoms and bonds with their orders."""
    out = {"id": None, "name": None, "formula": None, "charge": None, "atoms": [], "bonds": []}
    lines = list(cif_tokens(text))
    i = 0
    while i < len(lines):
        t = lines[i]
        if t[0].startswith("_chem_comp.") and len(t) >= 2:
            key, val = t[0].split(".", 1)[1], t[1]
            if key == "id":
                out["id"] = val
            elif key == "name":
                out["name"] = val
            elif key == "formula":
                out["formula"] = re.sub(r"\s+", " ", val).strip()
            elif key == "pdbx_formal_charge":
                out["charge"] = val
        elif t[0] == "loop_":
            cols, j = [], i + 1
            while j < len(lines) and lines[j][0].startswith("_"):
                cols.append(lines[j][0])
                j += 1
            rows = []
            while j < len(lines) and lines[j][0] not in ("#", "loop_") and not lines[j][0].startswith("_"):
                if len(lines[j]) == len(cols):
                    rows.append(dict(zip(cols, lines[j])))
                j += 1
            if cols and cols[0].startswith("_chem_comp_atom."):
                out["atoms"] = [{"id": r["_chem_comp_atom.atom_id"],
                                 "element": r["_chem_comp_atom.type_symbol"].upper(),
                                 "charge": r.get("_chem_comp_atom.charge", "0")} for r in rows]
            elif cols and cols[0].startswith("_chem_comp_bond."):
                out["bonds"] = [{"a": r["_chem_comp_bond.atom_id_1"], "b": r["_chem_comp_bond.atom_id_2"],
                                 "order": r["_chem_comp_bond.value_order"],
                                 "aromatic": r.get("_chem_comp_bond.pdbx_aromatic_flag", "N")} for r in rows]
            i = j
            continue
        i += 1
    return out


# ------------------------------------------------------------------------------------------------ geometry

def unit(v):
    return v / np.linalg.norm(v)


def local_axes(ca, window=AXIAL_WINDOW):
    """{resnum: unit vector along the local helix axis}, from CA(i+window) - CA(i-window)."""
    return {i: unit(ca[i + window] - ca[i - window])
            for i in ca if (i - window) in ca and (i + window) in ca}


def membrane_normal(axes, residues):
    """Sign-aligned mean of the local helix axes, iterated to a fixed point. Sign is fixed later."""
    keys = sorted(set(residues) & set(axes))
    if not keys:
        raise SystemExit("no helical residue has a local axis: cannot derive a membrane normal")
    n = axes[keys[0]].copy()
    for _ in range(100):
        s = np.zeros(3)
        for k in keys:
            d = np.dot(axes[k], n)
            s += axes[k] * (1.0 if d >= 0 else -1.0)
        nn = unit(s)
        if np.dot(nn, n) > 1 - 1e-14:
            n = nn
            break
        n = nn
    return n, keys


def axial_runs(ca, axes, helical, normal):
    """Maximal runs of helical residues whose local axis is within AXIAL_DEGREES of the normal."""
    cut = np.cos(np.radians(AXIAL_DEGREES))
    axial = sorted(i for i in sorted(set(helical) & set(axes)) if abs(np.dot(axes[i], normal)) >= cut)
    runs = []
    for i in axial:
        if runs and i - runs[-1][1] <= BRIDGE + 1:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    out = []
    for s, e in runs:
        pts = np.array([ca[i] for i in range(s, e + 1) if i in ca])
        proj = pts @ normal
        v = unit(pts[-1] - pts[0]) if len(pts) > 1 else normal
        out.append({"start": s, "end": e, "n_ca": int(len(pts)),
                    "span_along_normal": float(proj.max() - proj.min()),
                    "tilt_deg": float(np.degrees(np.arccos(min(1.0, abs(np.dot(v, normal))))))})
    return out


def kabsch(P, Q):
    """Rotation R and translation t minimising |R p + t - q|, with the reflection removed."""
    pc, qc = P.mean(0), Q.mean(0)
    U, _, Vt = np.linalg.svd((P - pc).T @ (Q - qc))
    d = 1.0 if np.linalg.det(Vt.T @ U.T) > 0 else -1.0
    R = Vt.T @ np.diag([1.0, 1.0, d]) @ U.T
    return R, qc - R @ pc


def rmsd(P, Q):
    return float(np.sqrt(((P - Q) ** 2).sum(1).mean()))


def fit_axis(pts):
    """(centroid, unit direction N->C) of the best line through a helix's CA atoms."""
    c = pts.mean(0)
    _, _, Vt = np.linalg.svd(pts - c)
    v = Vt[0]
    if np.dot(pts[-1] - pts[0], v) < 0:
        v = -v
    return c, unit(v)


# ----------------------------------------------------------------------------------------------- rounding

def r(x, nd=2):
    """Round for the output, with no negative zero (it would make the bytes depend on the sign of 0)."""
    v = round(float(x) + 0.0, nd)
    return 0.0 if v == 0 else v


def flat(points, nd=2):
    return [r(c, nd) for p in points for c in p]


def ranges(nums):
    """Sorted residue numbers as [[first, last], ...] runs: much smaller than one entry per residue."""
    out = []
    for i in sorted(nums):
        if out and i == out[-1][1] + 1:
            out[-1][1] = i
        else:
            out.append([i, i])
    return out


def dump(obj):
    """Compact, stable JSON bytes, as site/data/*.json is written."""
    return (json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


# -------------------------------------------------------------------------------------------------- build

def check_expected(state, pdb, gaps):
    """Fail loudly when the file is not the structure this script was written against."""
    chain, het = state["chain"], state["het"]
    ca = {k[1]: v for k, v in pdb["ca"].items() if k[0] == chain and k[2] == " "}
    icoded = [k for k in pdb["ca"] if k[0] == chain and k[2] != " "]
    if icoded:
        gaps.append(f"{state['pdb']} chain {chain}: {len(icoded)} CA atom(s) carry an insertion code and were "
                    f"dropped, because a residue number is the only key the morph can use")
    if pdb["models"] > 1:
        gaps.append(f"{state['pdb']}: {pdb['models']} MODEL records; only the first set of coordinates is read")
    if len(ca) != state["n_ca"]:
        raise SystemExit(f"{state['pdb']} chain {chain}: {len(ca)} CA atoms, expected {state['n_ca']}. "
                         f"The deposit changed; re-read it before trusting anything downstream.")
    lig = [a for a in pdb["het"].get(het, []) if a["chain"] == chain]
    seqs = sorted({a["seq"] for a in lig})
    if len(seqs) != 1:
        raise SystemExit(f"{state['pdb']}: ligand {het} occurs at {len(seqs)} residues {seqs} in chain {chain}, "
                         f"expected exactly one copy")
    if len(lig) != state["n_lig"]:
        raise SystemExit(f"{state['pdb']}: ligand {het} has {len(lig)} atoms, expected {state['n_lig']}")
    if pdb["het_counts"].get(het) not in (None, state["n_lig"]):
        gaps.append(f"{state['pdb']}: the HET record says {het} has {pdb['het_counts'][het]} atoms but "
                    f"{len(lig)} HETATM records were read")
    if pdb["resolution"] is None:
        gaps.append(f"{state['pdb']}: no resolution could be read from REMARK 2")
    if not pdb["deposited"]:
        gaps.append(f"{state['pdb']}: the HEADER deposition date could not be parsed")
    return ca, lig, seqs[0]


def ligand(state, pdb, lig, ccd, gaps):
    """The ligand in the {z, xyz, b} encoding of site/data/mol/*.json, with bond orders from the CCD."""
    het = state["het"]
    if ccd["id"] != het:
        raise SystemExit(f"the chemical component file for {het} declares id {ccd['id']!r}")
    by_id = {a["id"]: a for a in ccd["atoms"]}
    unknown = [a["name"] for a in lig if a["name"] not in by_id]
    if unknown:
        raise SystemExit(f"{state['pdb']} {het}: atom name(s) {unknown} are not in the {het} component "
                         f"dictionary, so their bonds cannot be assigned")
    idx = {a["name"]: i for i, a in enumerate(lig)}
    z = []
    for a in lig:
        el = a["element"] or by_id[a["name"]]["element"]
        if el not in Z:
            raise SystemExit(f"{state['pdb']} {het}: unknown element {el!r} on atom {a['name']}")
        z.append(Z[el])
    if 1 in z:
        gaps.append(f"{state['pdb']} {het}: hydrogens are present in the deposit and were kept; the page's "
                    f"heavy-atom claim no longer holds")
    bonds, dropped = [], 0
    for b in ccd["bonds"]:
        if b["a"] not in idx or b["b"] not in idx:
            dropped += 1                                   # a bond to an atom the deposit does not model (H)
            continue
        o = AROMATIC if b["aromatic"].upper() == "Y" else ORDER.get(b["order"].upper())
        if o is None:
            raise SystemExit(f"{het}: unknown bond order {b['order']!r} between {b['a']} and {b['b']}")
        bonds.append((idx[b["a"]], idx[b["b"]], o))
    bonds.sort()
    # cross-check the connectivity against the deposit's own CONECT records
    conect = set()
    for a, partners in pdb["conect"].items():
        if pdb["serial_atom"].get(a, (None,))[0] != het:
            continue
        for p in partners:
            if pdb["serial_atom"].get(p, (None,))[0] == het:
                i, j = idx[pdb["serial_atom"][a][1]], idx[pdb["serial_atom"][p][1]]
                conect.add((min(i, j), max(i, j)))
    ccd_pairs = {(min(i, j), max(i, j)) for i, j, _ in bonds}
    agree = conect == ccd_pairs
    if not agree:
        gaps.append(f"{state['pdb']} {het}: the CONECT records and the {het} component dictionary disagree on "
                    f"{len(conect ^ ccd_pairs)} bond(s); the dictionary was used")
    name = pdb["hetnam"].get(het) or ccd["name"]
    if ccd["name"] and pdb["hetnam"].get(het) and ccd["name"].upper() != pdb["hetnam"][het].upper():
        gaps.append(f"{het}: HETNAM says {pdb['hetnam'][het]!r} but the component dictionary says "
                    f"{ccd['name']!r}; HETNAM was used")
    return {"z": z, "b": [v for bond in bonds for v in bond],
            "names": [a["name"] for a in lig], "xyz_raw": np.array([a["xyz"] for a in lig])}, {
        "het": het, "name": name, "ccd_name": ccd["name"], "formula": pdb["formul"].get(het),
        "ccd_formula": ccd["formula"], "ccd_formal_charge": ccd["charge"], "n_atoms": len(lig),
        "n_bonds": len(bonds), "hydrogens_in_deposit": int(1 in z),
        "bonds_from": "RCSB chemical component dictionary " + LIG_URL.format(het),
        "bonds_dropped_to_unmodelled_atoms": dropped,
        "conect_agrees": bool(agree)}


def chimera_window(pdb, chain):
    """Residue numbers of `chain` that the file's own DBREF/SEQADV say are not the primary UNP entry.

    Returns (set of residue numbers, list of sentences quoting the records). Empty when the chain maps to a
    single database entry, which is how 8YN3 chain R is deposited.
    """
    refs, notes = [], []
    i = 0
    lines = pdb["dbref"]
    while i < len(lines):
        line = lines[i]
        if line[:6] == "DBREF ":
            if line[12] == chain:
                refs.append((int(line[14:18]), int(line[20:24]), line[26:32].strip(), line[33:41].strip()))
            i += 1
        elif line[:6] == "DBREF1":
            if line[12] == chain:
                refs.append((int(line[14:18]), int(line[20:24]), line[26:32].strip(), line[47:67].strip()))
            i += 2 if i + 1 < len(lines) and lines[i + 1][:6] == "DBREF2" else 1
        else:
            i += 1
    if not refs:
        return set(), ["no DBREF record names this chain, so no database correspondence could be checked"]
    primary = max(((e - s, db) for s, e, _, db in refs), key=lambda t: t[0])[1]
    out = set()
    for s, e, _, db in refs:
        if db != primary:
            out.update(range(s, e + 1))
            notes.append(f"DBREF: residues {s}-{e} are {db}, not {primary}")
    for num, kind in sorted(pdb["seqadv"].get(chain, {}).items()):
        if "LINKER" in kind or "CHIMERA" in kind or "INSERTION" in kind:
            out.add(num)
            notes.append(f"SEQADV: residue {num} is marked {kind}")
    if not notes:
        notes.append(f"every DBREF record for this chain maps to {primary}")
    return out, notes


def build(sources, report=None):
    """The bytes a run writes, from the bytes of the four fetched files. Pure: --check needs no network."""
    gaps = []
    st = {}
    for s in STATES:
        pdb = parse_pdb(sources[("pdb", s["pdb"])])
        ca_raw, lig, lig_seq = check_expected(s, pdb, gaps)
        ccd = parse_ccd(sources[("lig", s["het"])])
        mol, lig_meta = ligand(s, pdb, lig, ccd, gaps)
        lig_meta["chain"] = s["chain"]
        lig_meta["residue"] = lig_seq
        ca = {i: np.array(v["xyz"]) for i, v in ca_raw.items()}
        seq = {i: AA3[v["resn"]] for i, v in ca_raw.items()}
        helical = set()
        for h in pdb["helix"]:
            if h["chain"] == s["chain"]:
                helical.update(range(h["start"], h["end"] + 1))
        helical &= set(ca)
        axes = local_axes(ca)
        normal, used = membrane_normal(axes, helical)
        runs = axial_runs(ca, axes, helical, normal)
        tm = [x for x in runs if x["span_along_normal"] >= TM_SPAN]
        rejected = [x for x in runs if x["span_along_normal"] < TM_SPAN]
        if len(tm) != 7:
            raise SystemExit(f"{s['pdb']} chain {s['chain']}: the geometry found {len(tm)} transmembrane "
                             f"helices, not 7: {[(x['start'], x['end']) for x in tm]}. The derivation in the "
                             f"docstring no longer fits this structure; fix it rather than hard-coding ranges.")
        # the cytoplasmic side: where the G protein / the scaffold chains and the post-TM7 helix sit
        rec_centre = np.mean([ca[i] for i in ca], 0)
        others = {c: np.mean(np.array(v), 0) for c, v in pdb["other_ca"].items() if c != s["chain"]}
        votes = {c: float(np.dot(p - rec_centre, normal)) for c, p in others.items()}
        after_tm7 = [i for i in ca if i > tm[6]["end"]]
        votes["post-TM7 (H8 and the C terminus) of the receptor itself"] = (
            float(np.dot(np.mean([ca[i] for i in after_tm7], 0) - rec_centre, normal)) if after_tm7 else 0.0)
        if not votes or all(v == 0 for v in votes.values()):
            raise SystemExit(f"{s['pdb']}: nothing in the file locates the cytoplasmic face")
        if min(votes.values()) < 0 < max(votes.values()):
            gaps.append(f"{s['pdb']}: the cytoplasmic-face markers disagree in sign: "
                        + ", ".join(f"{k} {v:+.1f} A" for k, v in sorted(votes.items())))
        flip = sum(votes.values()) < 0
        if flip:                                           # +normal now points into the cytoplasm
            normal = -normal
            votes = {k: -v for k, v in votes.items()}
        chim, chim_notes = chimera_window(pdb, s["chain"])
        st[s["key"]] = {
            "spec": s, "pdb": pdb, "ca": ca, "seq": seq, "normal": normal, "tm": tm,
            "rejected": rejected, "helical": helical, "n_helical_axes": len(used),
            "mol": mol, "lig_meta": lig_meta, "chimera": chim, "chimera_notes": chim_notes,
            "cytoplasmic_votes": votes, "centre": rec_centre,
        }

    inact, act = st["inactive"], st[REFERENCE]
    tmset = {k: {i for h in v["tm"] for i in range(h["start"], h["end"] + 1)} & set(v["ca"])
             for k, v in st.items()}
    both = sorted(set(inact["ca"]) & set(act["ca"]))
    same = [i for i in both if inact["seq"][i] == act["seq"][i]]
    diff = [i for i in both if inact["seq"][i] != act["seq"][i]]
    outside = [i for i in diff if i not in inact["chimera"] and i not in act["chimera"]]
    if outside:
        gaps.append(f"residues {outside} have the same number but a different residue type in the two "
                    f"deposits and are outside every DBREF/SEQADV window that would explain it")
    excluded = (inact["chimera"] | act["chimera"]) | set(diff)
    fit = sorted((tmset["inactive"] & tmset[REFERENCE]) - excluded)
    if len(fit) < 100:
        raise SystemExit(f"only {len(fit)} CA pairs survive for the superposition; that is too few to trust")
    P = np.array([inact["ca"][i] for i in fit])
    Q = np.array([act["ca"][i] for i in fit])
    R, t = kabsch(P, Q)
    fit_rmsd = rmsd((R @ P.T).T + t, Q)

    # one common frame: the active state's own frame, recentred on the superposed bundle
    origin = Q.mean(0)
    normal_c = unit(act["normal"])
    moved = {"inactive": {i: (R @ v) + t - origin for i, v in inact["ca"].items()},
             REFERENCE: {i: v - origin for i, v in act["ca"].items()}}
    mol_xyz = {"inactive": (R @ inact["mol"]["xyz_raw"].T).T + t - origin,
               REFERENCE: act["mol"]["xyz_raw"] - origin}
    # a sanity check the file keeps: the normal derived independently per state must survive the rotation
    normal_agreement = float(np.degrees(np.arccos(min(1.0, abs(np.dot(R @ inact["normal"], normal_c))))))
    if normal_agreement > 15:
        gaps.append(f"the two membrane normals differ by {normal_agreement:.1f} deg after superposition; "
                    f"the common frame's normal is the {REFERENCE} state's")

    # comparison superpositions, so the file can show why the TM-only restriction matters
    variants = []
    for label, sel in [("tm_helices_sequence_identical", fit),
                       ("tm_helices_by_residue_number", sorted(tmset["inactive"] & tmset[REFERENCE])),
                       ("whole_chain_by_residue_number", both),
                       ("tm_helices_without_tm6", sorted(
                           ((tmset["inactive"] & tmset[REFERENCE]) - excluded)
                           - set(range(inact["tm"][5]["start"], inact["tm"][5]["end"] + 1))))]:
        p = np.array([inact["ca"][i] for i in sel])
        q = np.array([act["ca"][i] for i in sel])
        rr, tt = kabsch(p, q)
        variants.append({"selection": label, "n_ca": len(sel), "rmsd_angstrom": r(rmsd((rr @ p.T).T + tt, q), 3)})

    # ---- TM6: which end is cytoplasmic, and how far it moves
    tm6 = {k: (v["tm"][5]["start"], v["tm"][5]["end"]) for k, v in st.items()}
    tm6_common = sorted((set(range(tm6["inactive"][0], tm6["inactive"][1] + 1)) &
                         set(range(tm6[REFERENCE][0], tm6[REFERENCE][1] + 1))) &
                        set(moved["inactive"]) & set(moved[REFERENCE]))
    lo_depth = float(np.dot(moved[REFERENCE][tm6_common[0]], normal_c))
    hi_depth = float(np.dot(moved[REFERENCE][tm6_common[-1]], normal_c))
    low_is_cytoplasmic = lo_depth > hi_depth                    # +normal_c points into the cytoplasm
    end_res = tm6_common[:TM6_END_RESIDUES] if low_is_cytoplasmic else tm6_common[-TM6_END_RESIDUES:]
    tip = end_res[0] if low_is_cytoplasmic else end_res[-1]
    per_res = {i: float(np.linalg.norm(moved["inactive"][i] - moved[REFERENCE][i])) for i in tm6_common}
    cen_i = np.mean([moved["inactive"][i] for i in end_res], 0)
    cen_a = np.mean([moved[REFERENCE][i] for i in end_res], 0)
    dv = cen_a - cen_i
    lateral = dv - np.dot(dv, normal_c) * normal_c
    # outwardness: distance of that end from the bundle axis (the normal through the bundle centre, now 0)
    def radial(p):
        return p - np.dot(p, normal_c) * normal_c
    rad_i, rad_a = float(np.linalg.norm(radial(cen_i))), float(np.linalg.norm(radial(cen_a)))
    # the same displacement measured without any residue pairing: helix axis at one depth
    ax_i = fit_axis(np.array([moved["inactive"][i] for i in
                              range(tm6["inactive"][0], tm6["inactive"][1] + 1) if i in moved["inactive"]]))
    ax_a = fit_axis(np.array([moved[REFERENCE][i] for i in
                              range(tm6[REFERENCE][0], tm6[REFERENCE][1] + 1) if i in moved[REFERENCE]]))
    depth = 0.5 * (np.dot(moved["inactive"][tip], normal_c) + np.dot(moved[REFERENCE][tip], normal_c))

    def at_depth(c_v, z):
        c, v = c_v
        return c + v * ((z - np.dot(c, normal_c)) / np.dot(v, normal_c))

    geo = at_depth(ax_a, depth) - at_depth(ax_i, depth)
    axis_angle = float(np.degrees(np.arccos(min(1.0, abs(np.dot(ax_i[1], ax_a[1]))))))
    swing = r(np.linalg.norm(dv), 2)
    tm6_block = {
        "value_angstrom": swing,
        "value_rounded_angstrom": int(round(float(np.linalg.norm(dv)))),
        "sentence": (f"On activation the cytoplasmic end of TM6 moves {np.linalg.norm(dv):.1f} A, measured "
                     f"between PDB {inact['spec']['pdb']} and PDB {act['spec']['pdb']} after superposing "
                     f"their transmembrane bundles."),
        "definition": (f"Distance between the centroids of the CA atoms of residues "
                       f"{end_res[0]}-{end_res[-1]}, the {TM6_END_RESIDUES} residues at the cytoplasmic end "
                       f"of the stretch of TM6 present in both structures, in the common frame."),
        "precision_note": (f"The lower-resolution map is {inact['pdb']['resolution']} A, so this number is "
                           f"worth about 1 A: state it as {int(round(float(np.linalg.norm(dv))))} A, not to "
                           f"two decimals."),
        "end_residues": end_res,
        "tip_residue": tip,
        "cytoplasmic_end_is_low_residue_number": bool(low_is_cytoplasmic),
        "tm6_residues_common": [tm6_common[0], tm6_common[-1]],
        "lateral_in_membrane_plane_angstrom": r(np.linalg.norm(lateral), 2),
        "along_normal_angstrom": r(np.dot(dv, normal_c), 2),
        "distance_from_bundle_axis_angstrom": {"inactive": r(rad_i, 2), "active": r(rad_a, 2),
                                               "increase": r(rad_a - rad_i, 2)},
        "helix_axis_angle_between_states_deg": r(axis_angle, 2),
        "cross_check_helix_axis_angstrom": r(np.linalg.norm(geo), 2),
        "cross_check_note": ("The cross-check pairs no residues at all: it is the gap between the two TM6 "
                             "helix axes at one depth along the membrane normal, so it is unaffected by the "
                             "chimeric insert. It should agree with value_angstrom to about 1 A."),
        "per_residue_displacement_angstrom": {str(i): r(per_res[i], 2) for i in tm6_common},
        "method": ("Superpose on the CA atoms listed in superposition.selection, take the residues of TM6 "
                   "present in both structures, decide which end is cytoplasmic from "
                   "cytoplasmic_face.criterion, and measure the centroid displacement of that end."),
    }
    if not low_is_cytoplasmic:
        gaps.append("the cytoplasmic end of TM6 came out as its HIGH residue-number end, which is the "
                    "opposite of the class-A topology the rest of this file derives; check the normal's sign")

    # ---- the file
    states_out, meta_states = {}, {}
    for key in ("inactive", "active"):
        s, v = st[key]["spec"], st[key]
        nums = sorted(moved[key])
        states_out[key] = {
            "pdb": s["pdb"],
            "chain": s["chain"],
            "res": nums,
            "seq": "".join(v["seq"][i] for i in nums),
            "ca": flat([moved[key][i] for i in nums]),
            "gaps_in_chain": [[a, b] for a, b in zip(nums, nums[1:]) if b != a + 1],
            "tm": {f"TM{i + 1}": [h["start"], h["end"]] for i, h in enumerate(v["tm"])},
            "ligand": {"z": v["mol"]["z"], "xyz": flat(mol_xyz[key]), "b": v["mol"]["b"],
                       "names": v["mol"]["names"],
                       "src": f"PDB {s['pdb']} ligand {v['lig_meta']['het']} "
                              f"({v['lig_meta']['name'].lower()}), chain {s['chain']} residue "
                              f"{v['lig_meta']['residue']}"},
        }
        meta_states[key] = {
            "pdb_id": s["pdb"],
            "title": v["pdb"]["title"],
            "method": v["pdb"]["method"],
            "resolution_angstrom": v["pdb"]["resolution"],
            "deposition_date": v["pdb"]["deposited"],
            "header_classification": v["pdb"]["header"],
            "chain_used": s["chain"],
            "chains_discarded": s["drop_chains"],
            "n_ca": len(nums),
            "residue_range": [nums[0], nums[-1]],
            "ligand": v["lig_meta"],
            "download_url": PDB_URL.format(s["pdb"]),
            "ligand_dictionary_url": LIG_URL.format(v["lig_meta"]["het"]),
            "database_references": v["chimera_notes"],
            "non_primary_residue_numbers": ranges(v["chimera"]),
            "tm_helices": {f"TM{i + 1}": {"start": h["start"], "end": h["end"], "n_ca": h["n_ca"],
                                          "span_along_normal_angstrom": r(h["span_along_normal"], 2),
                                          "tilt_from_normal_deg": r(h["tilt_deg"], 2)}
                           for i, h in enumerate(v["tm"])},
            "helical_runs_rejected": [{"start": x["start"], "end": x["end"], "n_ca": x["n_ca"],
                                       "span_along_normal_angstrom": r(x["span_along_normal"], 2),
                                       "reason": f"spans {x['span_along_normal']:.1f} A along the membrane "
                                                 f"normal, below the {TM_SPAN:g} A a crossing needs"}
                                      for x in v["rejected"]],
            "n_helical_residues": len(v["helical"]),
            "cytoplasmic_face": {
                "criterion": ("Positive along meta.frame.membrane_normal. The sign is set by the mean "
                              "displacement, along the normal, of every other chain's CA centroid and of "
                              "the receptor's own post-TM7 segment, from the receptor's CA centroid: the G "
                              "protein, the antibody scaffold and the amphipathic helix after TM7 are all "
                              "intracellular, as this file's own COMPND records name them."),
                "markers_angstrom": {k: r(val, 2) for k, val in sorted(v["cytoplasmic_votes"].items())},
            },
            "membrane_normal_own_frame": [r(c, 4) for c in v["normal"]],
        }

    corr = {
        "both_same_residue": ranges(same),
        "both_different_residue": ranges(diff),
        "inactive_only": ranges(set(inact["ca"]) - set(act["ca"])),
        "active_only": ranges(set(act["ca"]) - set(inact["ca"])),
        "note": ("Residue numbers. both_same_residue: present in both deposits with the same residue type - "
                 "interpolate freely. both_different_residue: present in both at the same number but not the "
                 "same residue, because of the chimeric window meta.states.inactive."
                 "non_primary_residue_numbers - the backbone positions are still equivalent along the same "
                 "helix, so the morph may use them, but the superposition did not. inactive_only / "
                 "active_only: modelled in one state only, so there is nothing to interpolate towards and "
                 "the page should fade them rather than move them."),
    }
    out = {
        "v": 1,
        "meta": {
            "what": ("Two cryo-EM states of the human histamine H2 receptor, superposed on their "
                     "transmembrane bundle: the CA trace of the receptor and the ligand heavy atoms of "
                     "each, in one common frame, for the binding animation on site/receptor/."),
            "builder": "tools/build_receptor.py",
            "numpy": np.__version__,
            "licence": {"name": LICENCE[0], "terms": LICENCE[1], "url": LICENCE[2]},
            "frame": {
                "description": (f"The {REFERENCE} state's deposited frame, rotated nothing, translated so "
                                f"that the centroid of the superposed CA atoms is the origin. The inactive "
                                f"state is mapped into it by rotation then translation."),
                "units": "angstrom",
                "rounded_decimals": 2,
                "membrane_normal": [r(c, 6) for c in normal_c],
                "membrane_normal_points": "into the cytoplasm",
                "normal_disagreement_between_states_deg": r(normal_agreement, 2),
                "inactive_rotation_row_major": [r(c, 6) for row in R for c in row],
                "inactive_translation": [r(c, 6) for c in t],
                "common_translation_subtracted_from_everything": [r(-c, 6) for c in origin],
                "ligand_coordinates_are_centred": False,
            },
            "encoding": {
                "ca": "states.<key>.res[i] is the residue number of states.<key>.ca[3i : 3i+3]",
                "ligand": ("z, xyz and b exactly as site/data/mol/*.json encodes a conformer, so the "
                           "drawing code of site/js/gl/molviewer.js reads it unchanged: z atomic numbers, "
                           "xyz flat triples, b flat (i, j, order) triples with 4 meaning aromatic. Unlike "
                           "the conformer shards these coordinates are NOT centred - they sit in the common "
                           "frame, which is the whole point."),
                "ranges": "[[first, last], ...] inclusive runs of residue numbers",
            },
            "states": meta_states,
            "superposition": {
                "algorithm": "Kabsch via numpy.linalg.svd, with the reflection removed by negating the "
                             "third singular direction when the determinant is negative",
                "reference_state": REFERENCE,
                "selection": ("CA atoms of residues present in both deposits, with the same residue type, "
                              "inside a transmembrane helix of both (meta.states.<key>.tm_helices). The "
                              "whole chain is deliberately NOT used: ICL3, H8 and the termini differ "
                              "between the states and smear the fit, as the variants below show."),
                "n_ca_pairs": len(fit),
                "rmsd_angstrom": r(fit_rmsd, 3),
                "residues_used": ranges(fit),
                "residues_excluded_from_fit": ranges(excluded & set(both)),
                "variants": variants,
            },
            "tm_derivation": {
                "summary": ("Derived from each deposit's own HELIX records plus the coordinates; no helix "
                            "boundary in this file comes from anywhere else."),
                "steps": [
                    "A residue is helical when a HELIX record of that chain covers it.",
                    f"The membrane normal is the sign-aligned mean of the local helix axis "
                    f"CA(i+{AXIAL_WINDOW}) - CA(i-{AXIAL_WINDOW}) over every helical residue, iterated to a "
                    f"fixed point. The seven-helix bundle dominates it.",
                    f"A helical residue is axial when its local axis is within {AXIAL_DEGREES:g} deg of that "
                    f"normal. This drops H8 and the ICL2 surface helix, which lie across the membrane.",
                    f"Maximal runs of axial residues, joined across breaks of up to {BRIDGE} residues, are "
                    f"the candidates; a run spanning at least {TM_SPAN:g} A along the normal crosses the "
                    f"membrane.",
                    "Exactly seven survive in each structure and are named TM1..TM7 in sequence order. The "
                    "build fails rather than guessing if the count is not seven.",
                ],
                "caveat": ("These are the helical extents of these two models, not a canonical definition of "
                           "the H2 receptor's TM boundaries: the same helix ends a few residues apart in the "
                           "two deposits, which is real disorder at the helix ends, not an error."),
            },
            "tm6_outward_swing": tm6_block,
            "sources": sorted(sources["log"].values(), key=lambda e: e["url"]),
            "gaps": gaps,
        },
        "correspondence": corr,
        "states": states_out,
    }
    if report is not None:
        w = report.write
        for key in ("inactive", "active"):
            m = meta_states[key]
            w(f"{key:8s} {m['pdb_id']} chain {m['chain_used']} {m['n_ca']} CA  {m['resolution_angstrom']} A  "
              f"{m['deposition_date']}  ligand {m['ligand']['het']} {m['ligand']['name']}\n")
            w("         TM " + "  ".join(f"{k} {v['start']}-{v['end']}" for k, v in m["tm_helices"].items()) + "\n")
            if m["helical_runs_rejected"]:
                w("         rejected " + "  ".join(f"{x['start']}-{x['end']} "
                                                   f"({x['span_along_normal_angstrom']} A)"
                                                   for x in m["helical_runs_rejected"]) + "\n")
            w(f"         non-primary residue numbers {m['non_primary_residue_numbers']}\n")
        for v in variants:
            w(f"superpose {v['selection']:38s} n={v['n_ca']:3d} RMSD {v['rmsd_angstrom']} A\n")
        w(f"TM6 cytoplasmic end {tm6_block['value_angstrom']} A (residues {tm6_block['end_residues']}), "
          f"axis cross-check {tm6_block['cross_check_helix_axis_angstrom']} A, "
          f"axis tilt change {tm6_block['helix_axis_angle_between_states_deg']} deg\n")
        w(f"from bundle axis {tm6_block['distance_from_bundle_axis_angstrom']}\n")
        w(f"correspondence both-same {sum(b - a + 1 for a, b in corr['both_same_residue'])}, "
          f"both-different {sum(b - a + 1 for a, b in corr['both_different_residue'])}, "
          f"inactive-only {sum(b - a + 1 for a, b in corr['inactive_only'])}, "
          f"active-only {sum(b - a + 1 for a, b in corr['active_only'])}\n")
        w(f"gaps: {len(gaps)}\n")
        for g in gaps:
            w("  - " + g + "\n")
    return dump(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT, help="output JSON (default site/receptor/data/h2r.json)")
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="response cache directory (gitignored)")
    ap.add_argument("--check", action="store_true",
                    help="write nothing and use no network; exit 1 when the file on disk differs from what a "
                         "run would write")
    ap.add_argument("--report", action="store_true", help="print the derivation to stderr")
    args = ap.parse_args(argv)

    f = Fetcher(args.cache, offline=args.check)
    sources = {}
    for s in STATES:
        sources[("pdb", s["pdb"])] = f.get(PDB_URL.format(s["pdb"]),
                                           f"{s['key']} state: coordinates, HELIX, DBREF, HETATM")
        sources[("lig", s["het"])] = f.get(LIG_URL.format(s["het"]),
                                           f"{s['key']} state: ligand {s['het']} bond orders and name")
    sources["log"] = f.log
    data = build(sources, report=sys.stderr if args.report else None)

    if args.check:
        if not os.path.exists(args.out):
            print(f"FAIL {args.out} does not exist", file=sys.stderr)
            return 1
        with open(args.out, "rb") as fh:
            on_disk = fh.read()
        if on_disk != data:
            print(f"FAIL {args.out} differs from a rebuild ({len(on_disk)} bytes on disk, "
                  f"{len(data)} rebuilt)", file=sys.stderr)
            return 1
        print(f"OK {os.path.relpath(args.out, ROOT)} is byte-identical to a rebuild ({len(data)} bytes)")
        return 0

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    if os.path.exists(args.out):
        with open(args.out, "rb") as fh:
            if fh.read() == data:
                print(f"unchanged {os.path.relpath(args.out, ROOT)} ({len(data)} bytes)")
                return 0
    tmp = args.out + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, args.out)
    print(f"wrote {os.path.relpath(args.out, ROOT)} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
