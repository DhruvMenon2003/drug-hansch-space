#!/usr/bin/env python3
"""Build one ATC chemical group as a per-route table: the H2-receptor antagonists (A02BA) by default.

Why one row per mode of administration: a drug given by two routes is two different exposures of the same
molecule. The descriptors do not change with the route, but bioavailability, dose and the steady-state free drug
concentration do, and that is what a toxicity flag should look at. So each drug appears once per route, and each
row is an independent instance, as the project's rule 5 asks.

    python3 tools/build_cohort.py                  # A02BA, the H2-receptor antagonists
    python3 tools/build_cohort.py --atc4 A02BC     # another ATC chemical group
    python3 tools/build_cohort.py --no-net         # recompute from the request cache only

Every filled cell is fetched, never typed in by hand, and carries its own evidence:

    structure, formula, XLogP3        PubChem PUG REST, by generic name then by CID
    ATC level 1/2/4 names, DDD        the WHO ATC/DDD index page for the group; the DDD is per route
    mechanism, primary target         ChEMBL mechanism records
    in-vitro activity / toxicity      median pChEMBL at the primary target / at the strongest other target
    every descriptor, QED             RDKit on the PubChem structure
    modes of administration           openFDA label route counts, DailyMed SPL routeCode as the fallback
    bioavailability, half-life, LD50  read out of the US label text, with the sentence kept in the row

Formulas, as the source workbook writes them:
    Therapeutic Index               = LOG10(in-vivo toxicity) - LOG10(1 / in-vivo activity)
    In Vivo Free Drug Concentration = 1.44 * F * half-life(h) * dose(mg) / dose interval(h)
The workbook's index is log10(X * Y); the conventional log10(LD50 / ED50) is written out beside it, because the
in-vivo activity cell here holds a dose. The assumptions file says which to read.

Outputs site/data/cohort_<group>.json, cohort_<group>.csv (the workbook's own column order),
cohort_<group>_assumptions.md, and appends every request to site/data/provenance.csv.
"""
import argparse, csv, datetime as dt, hashlib, html, json, math, os, re, statistics, sys, time
from collections import defaultdict

import requests
from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, QED, rdMolDescriptors

RDLogger.DisableLog("rdApp.*")

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
WHO = "https://atcddd.fhi.no/atc_ddd_index/?code={}&showdescription=no"
CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
OPENFDA = "https://api.fda.gov/drug/label.json"
DAILYMED = "https://dailymed.nlm.nih.gov/dailymed/services/v2"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FDA_ROUTES = os.path.join(HERE, "tools", "inputs", "fda_route_of_administration.tsv")
PK_TABLE = os.path.join(HERE, "tools", "inputs", "{}_pk_tox.json")   # optional, one cited value per cell

IV = {"INTRAVENOUS", "INTRAVENOUS BOLUS", "INTRAVENOUS DRIP"}
MAX_ROUTES = 2                   # rule 3: two routes per drug, intravenous excluded from the count
BODY_KG = 70.0                   # the WHO DDD is for a 70 kg adult, so mg -> mg/kg divides by this
DDD_INTERVAL_H = 24.0            # a DDD is one day's maintenance dose
QED_PROPS = ("MW", "ALOGP", "HBA", "HBD", "PSA", "ROTB", "AROM", "ALERTS")

# WHO administration-route codes -> the FDA route vocabulary this project uses.
WHO_ROUTE = {
    "O": "ORAL", "P": "INTRAVENOUS", "N": "NASAL", "R": "RECTAL", "SL": "SUBLINGUAL", "TD": "TRANSDERMAL",
    "V": "VAGINAL", "S.C": "SUBCUTANEOUS", "S.C.": "SUBCUTANEOUS", "IMPLANT": "IMPLANTATION",
    "INHAL": "RESPIRATORY (INHALATION)", "INHAL.AEROSOL": "RESPIRATORY (INHALATION)",
    "INHAL.POWDER": "RESPIRATORY (INHALATION)", "INHAL.SOLUTION": "RESPIRATORY (INHALATION)",
    "ORAL AEROSOL": "RESPIRATORY (INHALATION)", "CHEWING GUM": "ORAL", "OINTMENT": "TOPICAL",
    "URETHRAL": "URETHRAL", "LAMELLA": "OPHTHALMIC", "INSTILL.SOL": "OPHTHALMIC",
}
UNIT_MG = {"mg": 1.0, "g": 1000.0, "mcg": 0.001, "ug": 0.001, "µg": 0.001, "U": None, "TU": None, "MU": None,
           "mmol": None, "ml": None}

# The workbook's own header row, in its own order and spelling.
SHEET_COLS = [
    "Compound Identifier", "Generic Name", "Anatomical(Organ System)", "Therapeutic(Indication)",
    "Mechanism of Action", "Chemical Group(Pharmacophore)", "Anatomical Therapeutic Chemical Code",
    "Molecular Weight", "Lipophilicity(log D)", "Hydrogen Bond Donors", "Hydrogen Bond Acceptors",
    "Topological Surface Area", "Rotatable Bonds", "Aromatic Rings", "Hammet Substituent Constant",
    "Molecular Refractivity Or Taft Steric Factor", "Quantitative Estimate of Drug Likeness",
    "Mode of Administration", "Mode of Administration2", "Structure", "Primary Biological Target",
    "In Vitro Toxicity(Binding affinity to Off Target)", "In Vitro Activity", "In Vivo Toxicity(Cell Culture)",
    "In Vivo Activity(Therapeutic Response)", "Therapeutic Index", "Bioavailability(Fraction Absorbed)",
    "Half Life", "Dosage", "Dose Interval", "In Vivo Free Drug Concentration", "Primary Toxicity Endpoint",
]
# Columns this build adds so every filled cell can be checked at a glance.
AUDIT_COLS = [
    "Route rank", "Route evidence", "Route FDA code", "Route NCI concept id",
    "In Vivo Toxicity kind", "In Vivo Toxicity route", "In Vivo Toxicity species",
    "Reported in-vivo activity", "Reported in-vivo activity kind",
    "Therapeutic Index (classical, log LD50/ED50)", "Dose-corrected bioavailability (F per mg)", "Exposure flag",
    "InChIKey", "ChEMBL id", "QED limiting term", "In Vitro Toxicity target", "In Vitro Activity n",
    "Fsp3", "Heavy atoms", "PubChem XLogP3", "Bioavailability evidence", "Half Life evidence",
    "In Vivo Toxicity evidence", "Dose evidence", "Edit_Flag",
]


# ---------------------------------------------------------------- HTTP with a disk cache and a provenance log
class Http:
    def __init__(self, cache_dir, offline=False):
        self.cache_dir, self.log, self.last, self.offline = cache_dir, [], 0.0, offline
        os.makedirs(cache_dir, exist_ok=True)
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "drug-hansch-space cohort build (research; github.com/DhruvMenon2003)"
        self.key = os.environ.get("OPENFDA_API_KEY") or os.environ.get("FDA_API_KEY") or ""

    def get(self, url):
        path = os.path.join(self.cache_dir, hashlib.sha1(url.encode()).hexdigest() + ".json")
        if os.path.exists(path):
            c = json.load(open(path, encoding="utf-8"))
            self.log.append({"url": url, "status": c["status"], "bytes": len(c["text"]), "utc": c["utc"],
                             "cached": True})
            return c["status"], c["text"]
        if self.offline:
            return None, "offline"
        send = url
        if url.startswith(OPENFDA) and self.key:          # the key never reaches the cache key or the log
            send = url + ("&" if "?" in url else "?") + "api_key=" + self.key
        status, text = None, ""
        for attempt in range(4):
            gap = 0.25 - (time.monotonic() - self.last)
            if gap > 0:
                time.sleep(gap)
            self.last = time.monotonic()
            try:
                r = self.s.get(send, timeout=120)
                status, text = r.status_code, r.text
            except requests.RequestException as e:
                status, text = None, str(e)
            if status in (200, 404):
                break
            time.sleep(min(30, 2 ** (attempt + 1)))
        utc = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        self.log.append({"url": url, "status": status, "bytes": len(text), "utc": utc, "cached": False})
        if status in (200, 404):
            json.dump({"status": status, "text": text, "utc": utc}, open(path, "w", encoding="utf-8"))
        return status, text

    def json(self, url):
        st, tx = self.get(url)
        if st != 200:
            return None
        try:
            return json.loads(tx)
        except ValueError:
            return None


def cell(value, source, evidence=""):
    """One filled cell: the number, where it came from, and the text it was read out of."""
    return {"value": value, "source": source, "evidence": evidence}


def num(c):
    return c["value"] if isinstance(c, dict) and isinstance(c.get("value"), (int, float)) else None


def pk_table(g4):
    """{drug name: {cell: {value, unit, source, ...}}} from tools/inputs/<group>_pk_tox.json, if it is there.

    The table is for the cells no API publishes: a bioavailability or a lethal dose that only a label's prose
    or a paper states. Every entry carries the document and the sentence it was read from, and a lethal dose
    also carries its kind, its route and its species, because an intravenous LD50, an oral LD50 and a
    two-year no-effect dose are not the same number and must not share a column silently."""
    path = PK_TABLE.format(g4)
    if not os.path.exists(path):
        return {}, {}
    js = json.load(open(path, encoding="utf-8"))
    return {(d.get("name") or "").lower(): d for d in js.get("drugs", [])}, js.get("meta", {})


def from_table(entry, key, fetched):
    """The fetched value when there is one, otherwise the table's, so a reading always beats a transcription."""
    if num(fetched) is not None:
        return fetched
    c = (entry or {}).get(key)
    if isinstance(c, dict) and isinstance(c.get("value"), (int, float)):
        return cell(c["value"], c.get("source", "cited table"), (c.get("source") or "")[:300])
    return fetched


# ---------------------------------------------------------------- WHO ATC and DDD
def atc_group(http, code):
    """The level-5 members of an ATC level-4 group, with the DDD the WHO index gives for each route.

    The index prints one row per drug and a further row per extra route, with the drug's cells left empty, so
    the current ATC code carries down the table."""
    url = WHO.format(code)
    st, tx = http.get(url)
    if st != 200:
        return [], url
    body = tx[tx.find("ATC code"):]
    body = body[:body.find("</table>")] if "</table>" in body else body
    members, cur = [], None
    for row in re.findall(r"<tr>(.*?)</tr>", body, re.S):
        cells = [re.sub(r"<[^>]+>", "", c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        cells = [html.unescape(c).replace("\xa0", " ").strip() for c in cells]
        if len(cells) < 5:
            continue
        acode = cells[0]
        if re.fullmatch(r"[A-Z]\d{2}[A-Z]{2}\d{2}", acode):
            name = re.sub(r"<[^>]+>", "", re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)[1])
            cur = {"atc": acode, "name": html.unescape(name).replace("\xa0", " ").strip().lower(), "ddd": {}}
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
                cur["ddd"][route] = {"mg": round(v * mult, 4), "who_adm": adm, "printed": f"{ddd} {unit} {adm}"}
    return members, url


def atc_levels(http, code):
    """{level: name} for every ATC level above and including this group, from the group page's own breadcrumb.

    The breadcrumb prints one line per level, the code in plain text and the name inside the link, so the four
    names come out of the page already fetched for the group's members."""
    st, tx = http.get(WHO.format(code))
    out = {}
    if st != 200:
        return out
    head = tx[:tx.find("ATC code")] if "ATC code" in tx else tx
    for m in re.finditer(r"([A-Z]\d*[A-Z]*\d*)\s*<b><a href=\"\./\?code=([A-Z0-9]+)&[^\"]*\">(.*?)</a></b>",
                         head, re.S):
        c = m.group(2)
        if code.startswith(c):
            out[c] = html.unescape(re.sub(r"<[^>]+>", "", m.group(3))).strip().lower()
    return out


# ---------------------------------------------------------------- PubChem
def pubchem(http, name):
    js = http.json(f"{PUG}/compound/name/{requests.utils.quote(name)}/cids/JSON")
    cids = ((js or {}).get("IdentifierList") or {}).get("CID") or []
    if not cids:
        return None, {}
    cid = int(cids[0])
    props = ("SMILES,ConnectivitySMILES,XLogP,TPSA,MolecularWeight,HBondDonorCount,HBondAcceptorCount,"
             "RotatableBondCount,HeavyAtomCount,MolecularFormula,Title,InChIKey")
    pj = http.json(f"{PUG}/compound/cid/{cid}/property/{props}/JSON")
    rows = ((pj or {}).get("PropertyTable") or {}).get("Properties") or [{}]
    return cid, rows[0]


# ---------------------------------------------------------------- ChEMBL
def chembl_molecule(http, atc, inchikey):
    """The ChEMBL molecule for an ATC level-5 code. ChEMBL carries the WHO ATC classification itself, so the
    code is the reliable key; the InChIKey is only the fallback, and it can land on a stereo-specific record
    that carries no activity data."""
    js = http.json(f"{CHEMBL}/molecule.json?atc_classifications__level5={atc}&limit=5")
    ms = (js or {}).get("molecules") or []
    if ms:
        ms.sort(key=lambda m: -float(m.get("max_phase") or 0))
        return ms[0].get("molecule_chembl_id"), f"ChEMBL ATC classification {atc}"
    js = http.json(f"{CHEMBL}/molecule.json?molecule_structures__standard_inchi_key={inchikey}&limit=1")
    ms = (js or {}).get("molecules") or []
    return (ms[0].get("molecule_chembl_id"), "ChEMBL InChIKey match") if ms else (None, "")


def chembl_forms(http, mid):
    """The salt and parent forms of one molecule, so activity measured on a salt is not missed."""
    js = http.json(f"{CHEMBL}/molecule_form.json?parent_chembl_id={mid}&limit=20")
    out = []
    for f in ((js or {}).get("molecule_forms") or []):
        for k in ("molecule_chembl_id", "parent_chembl_id"):
            if f.get(k) and f[k] != mid:
                out.append(f[k])
    return sorted(set(out))


def chembl_mechanisms(http, mid):
    js = http.json(f"{CHEMBL}/mechanism.json?molecule_chembl_id={mid}&limit=20")
    return [(m.get("target_chembl_id"), (m.get("mechanism_of_action") or "").strip())
            for m in ((js or {}).get("mechanisms") or []) if m.get("target_chembl_id")]


def chembl_potency(http, mid, target=None, limit=1000):
    """{target: (median pChEMBL, n values, n documents, assay types)} for one molecule."""
    js = http.json(f"{CHEMBL}/activity.json?molecule_chembl_id={mid}&pchembl_value__isnull=false"
                   f"{'&target_chembl_id=' + target if target else ''}&limit={limit}")
    by = defaultdict(lambda: {"p": [], "docs": set(), "types": set()})
    for a in ((js or {}).get("activities") or []):
        t, p = a.get("target_chembl_id"), a.get("pchembl_value")
        if not t or p in (None, ""):
            continue
        try:
            by[t]["p"].append(float(p))
        except (TypeError, ValueError):
            continue
        by[t]["docs"].add(a.get("document_chembl_id"))
        if a.get("standard_type"):
            by[t]["types"].add(a["standard_type"])
    return {t: (round(statistics.median(v["p"]), 2), len(v["p"]), len({d for d in v["docs"] if d}),
                ", ".join(sorted(v["types"])[:4])) for t, v in by.items() if v["p"]}


def chembl_target_name(http, tid):
    js = http.json(f"{CHEMBL}/target/{tid}.json")
    return (js or {}).get("pref_name") or tid


# ---------------------------------------------------------------- the FDA route legend
def fda_route_legend():
    out = {}
    if not os.path.exists(FDA_ROUTES):
        return out
    with open(FDA_ROUTES, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            name = (row.get("NAME") or "").strip().upper()
            if name:
                out[name] = ((row.get("SHORT NAME") or "").strip(), (row.get("FDA CODE") or "").strip(),
                             (row.get("NCI CONCEPT ID") or "").strip())
    return out


# ---------------------------------------------------------------- US labels: routes and the numbers in the text
def label_routes(http, name):
    """Route counts from US labels. openFDA first, DailyMed's SPL list as the fallback."""
    q = requests.utils.quote(f'openfda.generic_name:"{name}"')
    url = f"{OPENFDA}?search={q}&count=openfda.route.exact&limit=50"
    js = http.json(url)
    rows = [(str(r["term"]).upper(), int(r["count"])) for r in ((js or {}).get("results") or []) if r.get("term")]
    if rows:
        rows.sort(key=lambda r: (-r[1], r[0]))
        return rows, f"openFDA route counts on {len(rows)} coded route(s): " + \
                     ", ".join(f"{r} {n}" for r, n in rows[:6])
    counts = defaultdict(int)
    js = http.json(f"{DAILYMED}/spls.json?drug_name={requests.utils.quote(name)}&pagesize=50")
    for s in ((js or {}).get("data") or [])[:25]:
        setid = s.get("setid")
        if not setid:
            continue
        st, xml = http.get(f"{DAILYMED}/spls/{setid}.xml")
        if st != 200:
            continue
        for m in re.finditer(r'<routeCode[^>]*displayName="([^"]+)"', xml):
            counts[m.group(1).upper()] += 1
    rows = sorted(counts.items(), key=lambda r: (-r[1], r[0]))
    if rows:
        return rows, "DailyMed SPL routeCode counts: " + ", ".join(f"{r} {n}" for r, n in rows[:6])
    return [], "no US label found for this generic name"


def choose_routes(rows):
    """Rules 3 and 4: the two most-reported routes that are not intravenous, plus intravenous, which does not
    use up a slot. A drug reported only intravenously gets INTRAVENOUS and an iv_only flag."""
    non_iv = [r for r in rows if r[0] not in IV]
    iv = [r for r in rows if r[0] in IV]
    chosen = [r[0] for r in non_iv[:MAX_ROUTES]] + [r[0] for r in iv[:1]]
    flag = "iv_only" if (iv and not non_iv) else ("no_label_route" if not rows else "")
    return chosen, flag


SENT = re.compile(r"(?<!\d)\.(?=\s|$)")
NUM = r"(\d+(?:\.\d+)?)"


def sentences(text):
    return [re.sub(r"\s+", " ", s).strip() for s in SENT.split(text) if s.strip()]


def label_text(http, name, limit=25):
    """The prose of up to `limit` US labels for one generic name, joined, plus the query used."""
    q = requests.utils.quote(f'openfda.generic_name:"{name}"')
    url = f"{OPENFDA}?search={q}&limit={limit}"
    js = http.json(url)
    out = []
    for r in ((js or {}).get("results") or []):
        for k, v in r.items():
            if isinstance(v, list) and v and isinstance(v[0], str) and k != "openfda":
                out.append(" ".join(v))
    return "\n".join(out), url


def read_bioavailability(text, source):
    """A bioavailability fraction read out of the label, with the sentence it came from."""
    for s in sentences(text):
        low = s.lower()
        if "bioavailab" not in low or any(w in low for w in SPECIAL):
            continue
        m = re.search(NUM + r"\s*(?:%|percent)?\s*(?:to|-|–|and)\s*" + NUM + r"\s*(?:%|percent)", s, re.I) or \
            re.search(r"(?:is|was|of|approximately|about|around)\s*~?\s*" + NUM + r"\s*(?:%|percent)", s, re.I)
        if not m:
            continue
        vals = [float(g) for g in m.groups() if g]
        v = sum(vals) / len(vals) / 100.0
        if 0.01 <= v <= 1.0:
            return cell(round(v, 3), source, s[:300])
    return cell(None, "", "")


def read_half_life(text, source):
    """An elimination half-life in hours, read out of the label."""
    best = None
    for s in sentences(text):
        low = s.lower()
        if "half-life" not in low and "half life" not in low:
            continue
        if any(w in low for w in SPECIAL):
            continue                                   # a special population, not the ordinary adult value
        m = re.search(NUM + r"\s*(?:to|-|–)\s*" + NUM + r"\s*(?:hours?|hrs?|h\b)", s, re.I) or \
            re.search(r"(?:is|was|of|approximately|about|around)\s*~?\s*" + NUM + r"\s*(?:hours?|hrs?|h\b)", s,
                      re.I)
        if not m:
            continue
        vals = [float(g) for g in m.groups() if g]
        v = sum(vals) / len(vals)
        if 0.05 <= v <= 400 and (best is None or "eliminat" in low):
            best = cell(round(v, 2), source, s[:300])
            if "eliminat" in low:
                return best
    return best or cell(None, "", "")


NEGATED = ("not lethal", "nonlethal", "non-lethal", "without effect", "no deaths", "no mortality",
           "dominant lethal", "no lethality", "were not", "was not")
LETHAL = r"(?:LD\s*50|LD\s*50s|median lethal dose|minimum lethal|lethal dose|lethal single|lethal oral)"


def read_ld50(text, source):
    """An acute lethal dose in mg/kg out of the label's non-clinical or overdose text, lowest one stated.

    The number has to sit next to a lethal-dose statement: labels are full of 'doses up to 200 mg/kg' and
    'a single oral dose of 1000 mg/kg was without effect', which are not lethal doses."""
    found = []
    for s in sentences(text):
        low = s.lower()
        if "mg/kg" not in low or not re.search(LETHAL, s, re.I):
            continue
        if any(n in low for n in NEGATED):
            continue
        flat = re.sub(r"(?<=\d),(?=\d\d\d)", "", s)             # 1,000 mg/kg -> 1000 mg/kg
        near = re.findall(LETHAL + r"[^.]{0,90}?" + NUM + r"(?:\s*(?:to|-|–|and)\s*" + NUM + r")?\s*mg/kg",
                          flat, re.I) + \
               re.findall(NUM + r"(?:\s*(?:to|-|–|and)\s*" + NUM + r")?\s*mg/kg[^.]{0,40}?" + LETHAL,
                          flat, re.I)
        for groups in near:
            vals = [float(g) for g in (groups if isinstance(groups, tuple) else (groups,)) if g]
            vals = [v for v in vals if v >= 1]
            if vals:
                found.append((min(vals), s[:300]))
    if not found:
        return cell(None, "", "")
    v, s = min(found, key=lambda r: r[0])
    return cell(v, source, s)


SPECIAL = ("renal insufficien", "creatinine clearance", "impair", "pediatric", "paediatric", "neonat",
           "children", "cirrho", "hepatic", "elderly", "geriatric", "dialysis")


def read_endpoint(http, name):
    """The label's own most serious documented toxicity, for the primary toxicity endpoint column."""
    q = requests.utils.quote(f'openfda.generic_name:"{name}"')
    url = f"{OPENFDA}?search={q}&limit=10"
    js = http.json(url)
    for field in ("boxed_warning", "warnings_and_precautions", "warnings", "adverse_reactions"):
        for r in ((js or {}).get("results") or []):
            v = r.get(field)
            if isinstance(v, list) and v and isinstance(v[0], str):
                ss = sentences(" ".join(v))
                ss = [x for x in ss if len(x) > 40 and not x.isupper()]
                if ss:
                    label = field.replace("_", " ")
                    return cell(f"{label}: {ss[0][:240]}", f"US drug label via openFDA ({url})", ss[0][:300])
    return cell(None, "", "")


# ---------------------------------------------------------------- descriptors
def descriptors(mol):
    p = QED.properties(mol)
    des = {n: QED.ads(float(v), QED.adsParameters[n]) for n, v in p._asdict().items()}
    return {
        "mw": round(Descriptors.MolWt(mol), 2), "logp": round(Crippen.MolLogP(mol), 2),
        "mr": round(Crippen.MolMR(mol), 2), "tpsa": round(rdMolDescriptors.CalcTPSA(mol), 1),
        "hbd": rdMolDescriptors.CalcNumLipinskiHBD(mol), "hba": rdMolDescriptors.CalcNumLipinskiHBA(mol),
        "rotb": rdMolDescriptors.CalcNumRotatableBonds(mol), "arom": rdMolDescriptors.CalcNumAromaticRings(mol),
        "fsp3": round(rdMolDescriptors.CalcFractionCSP3(mol), 3), "heavy": mol.GetNumHeavyAtoms(),
        "qed": round(QED.qed(mol, qedProperties=p), 3), "alerts": p.ALERTS,
        "qlim": min(QED_PROPS, key=lambda n: des[n]), "qdes": {n: round(des[n], 3) for n in QED_PROPS},
    }


# ---------------------------------------------------------------- the formulas
def therapeutic_index(tox, act):
    """The workbook's formula, LOG(tox) - LOG(1/act), which equals log10(tox * act)."""
    if not tox or not act or tox <= 0 or act <= 0:
        return None
    return round(math.log10(tox) - math.log10(1.0 / act), 3)


def ti_classical(tox, act):
    """log10(LD50 / ED50): the conventional therapeutic index, for comparison."""
    if not tox or not act or tox <= 0 or act <= 0:
        return None
    return round(math.log10(tox / act), 3)


def free_concentration(F, half_life, dose, interval):
    """The workbook's =(1.44*F*t.half*Dose/tau): the average amount in the body at steady state."""
    if None in (F, half_life, dose, interval) or not interval:
        return None
    return round(1.44 * F * half_life * dose / interval, 2)


# ---------------------------------------------------------------- build
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=os.path.join(HERE, "site"))
    ap.add_argument("--atc4", default="A02BA", help="the ATC level-4 chemical group to build")
    ap.add_argument("--target", default=None, help="the ChEMBL target to treat as the primary one")
    ap.add_argument("--cache", default=os.path.join(HERE, "tools", "data", "cache_cohort"))
    ap.add_argument("--no-net", action="store_true")
    a = ap.parse_args(argv)
    g4 = a.atc4.upper()
    http = Http(a.cache, offline=a.no_net)
    legend = fda_route_legend()
    table, table_meta = pk_table(g4)
    assume = []
    if table_meta.get("warning"):
        assume.append(table_meta["warning"])

    members, who_url = atc_group(http, g4)
    if not members:
        print(f"no ATC level-5 codes found under {g4}", file=sys.stderr)
        return 1
    lv = atc_levels(http, g4)
    l1, l2, l3, l4 = lv.get(g4[:1], ""), lv.get(g4[:3], ""), lv.get(g4[:4], ""), lv.get(g4, "")
    print(f"{g4} {l4}: {len(members)} members  ({l1} / {l2} / {l3})")

    drugs, target_votes = [], defaultdict(int)
    for rec in members:
        name = rec["name"]
        cid, props = pubchem(http, name)
        rec["cid"] = cid
        if not cid:
            rec["note"] = "PubChem has no single compound under this name (a combination or a salt-only entry)"
            assume.append(f"{name} ({rec['atc']}): {rec['note']}, so the row is left out of the table.")
            print(f"  {rec['atc']} {name:28s} no PubChem compound")
            continue
        smiles = props.get("SMILES") or props.get("ConnectivitySMILES") or ""
        mol = Chem.MolFromSmiles(smiles) if smiles else None
        if mol is None:
            rec["note"] = "the PubChem structure would not parse"
            assume.append(f"{name} ({rec['atc']}): {rec['note']}, so the row is left out of the table.")
            continue
        frags = Chem.GetMolFrags(mol, asMols=True, sanitizeFrags=True)
        if len(frags) > 1:                       # a salt or co-crystal: the largest fragment is the drug
            mol = max(frags, key=lambda m: m.GetNumHeavyAtoms())
            assume.append(f"{name}: the PubChem record is a mixture of {len(frags)} fragments, so the largest "
                          f"one is taken as the drug, as the curation rules require.")
        rec["smiles"] = Chem.MolToSmiles(mol)
        rec["ik"] = Chem.MolToInchiKey(mol)
        rec["formula"] = props.get("MolecularFormula", "")
        rec["xlogp"] = props.get("XLogP")
        rec["d"] = descriptors(mol)

        mid, how = chembl_molecule(http, rec["atc"], rec["ik"])
        rec["chembl"], rec["chembl_how"] = mid, how
        mechs = chembl_mechanisms(http, mid) if mid else []
        rec["mechanism"] = "; ".join(sorted({m for _, m in mechs if m}))
        for t, _ in mechs:
            target_votes[t] += 1
        rec["pot"] = chembl_potency(http, mid) if mid else {}
        rec["forms"] = []

        rows, rev = label_routes(http, name)
        rec["routes"], rec["route_flag"] = choose_routes(rows)
        rec["route_evidence"], rec["route_counts"] = rev, rows[:6]
        if not rec["routes"] and rec["ddd"]:
            # no US label, but the WHO index itself codes an administration route for the DDD of this code
            who_rows = [(r, 1) for r in rec["ddd"]]
            rec["routes"], _ = choose_routes(who_rows)
            rec["route_flag"] = "route_from_who_ddd"
            rec["route_evidence"] = ("no US label for this generic name; the route is the one the WHO ATC/DDD "
                                     "index codes for this ATC code: " +
                                     ", ".join(f'{r} ({v["printed"]})' for r, v in rec["ddd"].items()))

        text, lurl = label_text(http, name)
        src = f"US drug label text via openFDA ({lurl})"
        rec["F"] = read_bioavailability(text, src)
        rec["t_half"] = read_half_life(text, src)
        rec["ld50"] = read_ld50(text, src)
        rec["endpoint"] = read_endpoint(http, name)
        t = table.get(name)
        rec["F"] = from_table(t, "F", rec["F"])
        rec["t_half"] = from_table(t, "half_life_h", rec["t_half"])
        tox = (t or {}).get("invivo_tox") or {}
        if isinstance(tox.get("value"), (int, float)):
            # the table wins here, unlike F and the half-life, because it is the only one of the two that
            # says what kind of number this is: an oral LD50, an intravenous LD50 and a no-effect dose are
            # not comparable, and the label reader returns a bare figure
            read = num(rec["ld50"])
            if read is not None and abs(read - tox["value"]) > 0.01:
                assume.append(f"{name}: the lethal dose is the cited {tox.get('route', '')} "
                              f"{tox.get('kind', 'value')} of {tox['value']} mg/kg, not the {read} mg/kg the "
                              f"label reader took from the label text, because only the cited value carries "
                              f"the route and species the figure belongs to.")
            rec["ld50"] = cell(tox["value"], tox.get("source", "cited table"), (tox.get("source") or "")[:300])
            rec["tox_kind"] = tox.get("bound", "") + tox.get("kind", "")
            rec["tox_route"] = tox.get("route", "")
            rec["tox_species"] = tox.get("species", "")
            rec["tox_in_ti"] = bool(tox.get("use_in_therapeutic_index"))
        else:
            rec["tox_kind"] = "LD50 read from the label text" if num(rec["ld50"]) is not None else ""
            rec["tox_route"], rec["tox_species"] = "", ""
            rec["tox_in_ti"] = num(rec["ld50"]) is not None
        ra = (t or {}).get("invivo_act") or {}
        rec["rep_act"] = f"{ra['value']} {ra.get('unit', '')}".strip() if ra.get("value") is not None else ""
        rec["rep_act_kind"] = ra.get("kind", "")
        rec["note"] = (t or {}).get("note", "")
        rec["conc_ok"] = (t or {}).get("free_concentration_valid", True)
        print(f"  {rec['atc']} {name:28s} cid={cid:<9} qed={rec['d']['qed']:.2f} "
              f"F={rec['F']['value']} t½={rec['t_half']['value']} LD50={rec['ld50']['value']} "
              f"routes={','.join(rec['routes']) or '-'}{' [' + rec['route_flag'] + ']' if rec['route_flag'] else ''}")
        drugs.append(rec)

    target = a.target or (max(target_votes, key=target_votes.get) if target_votes else None)
    tname = chembl_target_name(http, target) if target else ""
    if target:
        # the primary target deserves its own query: a molecule's first 1000 activities need not include it
        for rec in drugs:
            if not rec.get("chembl") or target in rec["pot"]:
                continue
            got = chembl_potency(http, rec["chembl"], target=target)
            if not got:
                for sib in chembl_forms(http, rec["chembl"]):
                    got = chembl_potency(http, sib, target=target)
                    if got:
                        rec["forms"] = [sib]
                        assume.append(f"{rec['name']}: the in-vitro activity is measured on {sib}, a salt or "
                                      f"parent form of {rec['chembl']}, because ChEMBL holds no measurement at "
                                      f"{target} for {rec['chembl']} itself.")
                        break
            rec["pot"].update(got)
    if target:
        assume.append(f"The primary biological target is taken to be {target} ({tname}): the mechanism target "
                      f"ChEMBL gives for {target_votes[target]} of the {len(drugs)} members that have a "
                      f"structure.")

    rows = []
    for rec in drugs:
        d, L = rec["d"], rec["ld50"]
        act = rec["pot"].get(target)
        off = sorted(((t, v) for t, v in rec["pot"].items() if t != target), key=lambda kv: -kv[1][0])
        offt, offv = (off[0][0], off[0][1]) if off else (None, None)
        for route in (rec["routes"] or ["NaN"]):
            flags = [f for f in [rec["route_flag"]] if f]
            # bioavailability: 1 by definition for an intravenous row, otherwise the label's figure
            if route in IV:
                F = cell(1.0, "definition", "bioavailability is 1 by definition for an intravenous dose")
            else:
                F = rec["F"]
                if F["value"] is None:
                    flags.append("bioavailability not stated in the label text")
            # the dose: the WHO DDD for this route, which is a daily dose
            ddd = rec["ddd"].get(route)
            if ddd is None and route in IV:
                ddd = rec["ddd"].get("INTRAVENOUS")
            if ddd is None:
                ddd = rec["ddd"].get("ORAL")
                if ddd:
                    flags.append("the WHO DDD is not route-specific for this route, the oral DDD is used")
            dose = cell(ddd["mg"], f"WHO ATC/DDD index ({who_url})", f"DDD {ddd['printed']}") if ddd \
                else cell(None, "", "")
            if dose["value"] is None:
                flags.append("the WHO index gives no DDD for this drug")
            if num(rec["ld50"]) is not None and not rec.get("tox_in_ti"):
                flags.append(f"no therapeutic index: the toxicity figure is a "
                             f"{rec.get('tox_kind') or 'non-lethal-dose'} value, not a lethal dose")
            if rec.get("tox_route") and route not in IV and rec["tox_route"] == "intravenous":
                flags.append("the lethal dose is intravenous while this row is not, so the index compares "
                             "only with the other intravenous lethal doses in the group")
            tau = cell(DDD_INTERVAL_H, "definition", "a defined daily dose is one day's maintenance dose")
            if rec.get("note"):
                flags.append(rec["note"])
            conc = free_concentration(num(F), num(rec["t_half"]), num(dose), num(tau)) \
                if rec.get("conc_ok", True) else None
            act_dose = round(num(dose) / BODY_KG, 4) if num(dose) else None      # mg/kg for a 70 kg adult
            rows.append({
                "cid": rec["cid"], "name": rec["name"], "atc": rec["atc"], "route": route,
                "route_rank": (rec["routes"].index(route) + 1) if route in rec["routes"] else None,
                "route_other": ", ".join(r for r in rec["routes"] if r != route),
                "route_fda_code": legend.get(route, ("", "", ""))[1],
                "route_nci": legend.get(route, ("", "", ""))[2],
                "route_evidence": rec["route_evidence"], "route_counts": rec["route_counts"],
                "l1": l1, "l2": l2, "l3": l3, "l4": l4, "smiles": rec["smiles"], "formula": rec["formula"],
                "ik": rec["ik"], "chembl": rec["chembl"], "mechanism": rec["mechanism"],
                "target": target, "target_name": tname, "d": d, "xlogp": rec["xlogp"],
                "chembl_how": rec.get("chembl_how", ""), "endpoint": rec["endpoint"],
                "act": act[0] if act else None, "act_n": act[1] if act else None,
                "act_ndoc": act[2] if act else None, "act_types": act[3] if act else "",
                "offtox": offv[0] if offv else None, "offtox_target": offt,
                "offtox_name": chembl_target_name(http, offt) if offt else "",
                "invivo_tox": L, "invivo_act": cell(act_dose, dose["source"], dose["evidence"]),
                "tox_kind": rec.get("tox_kind", ""), "tox_route": rec.get("tox_route", ""),
                "tox_species": rec.get("tox_species", ""), "rep_act": rec.get("rep_act", ""),
                "rep_act_kind": rec.get("rep_act_kind", ""),
                "ti": therapeutic_index(num(L), act_dose) if rec.get("tox_in_ti") else None,
                "ti_classical": ti_classical(num(L), act_dose) if rec.get("tox_in_ti") else None,
                "F": F, "t_half": rec["t_half"], "dose": dose, "tau": tau, "free_conc": conc,
                "F_per_mg": round(num(F) / num(dose), 5) if (num(F) and num(dose)) else None,
                "flags": flags,
            })

    # the exposure flag: a route whose steady-state exposure is at least twice this drug's lowest route
    by = defaultdict(list)
    for r in rows:
        if r["free_conc"] is not None:
            by[r["name"]].append(r)
    for rs in by.values():
        lo = min(r["free_conc"] for r in rs)
        for r in rs:
            if lo > 0 and r["free_conc"] / lo >= 2:
                r["flags"].append(f"steady-state exposure {r['free_conc'] / lo:.1f}x this drug's lowest route")
    concs = sorted(r["free_conc"] for r in rows if r["free_conc"] is not None)
    if len(concs) >= 4:
        p75 = concs[int(0.75 * (len(concs) - 1))]
        for r in rows:
            if r["free_conc"] is not None and r["free_conc"] >= p75:
                r["flags"].append("in the top quarter of the group's steady-state exposure")

    assume += [
        "Hammet Substituent Constant is left empty in every row. A Hammett sigma is defined for a substituent on "
        "a fixed parent ring, and the members of this group differ in the ring itself, so no common parent "
        "exists and no sigma can be read off a table. Molar refractivity fills the steric half of the same "
        "column pair.",
        "Lipophilicity(log D) holds the Crippen log P computed by RDKit, with PubChem's XLogP3 kept beside it. "
        "Neither is a log D: a distribution coefficient at pH 7.4 needs each drug's pKa, which none of the "
        "sources used here publish.",
        "In Vivo Toxicity(Cell Culture) holds a whole-animal figure, the lowest acute lethal dose in mg/kg "
        "stated in the US label text, not a cell-culture figure. The workbook's own formula calls this cell the "
        "in-vivo toxicity parameter, and no cell-culture toxicity value for these drugs exists in the open "
        "sources used here.",
        "In Vivo Activity(Therapeutic Response) holds the WHO defined daily dose for that route, converted to "
        f"mg/kg for a {BODY_KG:.0f} kg adult. A DDD is the assumed average maintenance dose for the drug's main "
        "indication in adults, so it is a dose that produces the therapeutic response, and the WHO publishes it "
        "per route, which is what makes the per-route comparison possible.",
        "Therapeutic Index is computed exactly as the workbook writes it, LOG(toxicity) - LOG(1/activity), which "
        "equals log10(toxicity x activity). The conventional index, log10(LD50/ED50), is in its own column. The "
        "workbook's form is the right one when the activity cell holds a potency, where bigger means more "
        "active; the classical form is the right one when it holds a dose in mg/kg, which is the case here, so "
        "the classical column is the one to read.",
        "Dose Interval is 24 hours in every row, because a defined daily dose is one day's dose. A label's own "
        "dosing interval would differ by product and strength, and is not comparable across routes.",
        "Bioavailability and half-life are read out of the label prose by pattern, and each row keeps the "
        "sentence the number came from so it can be checked. Sentences about renal or hepatic impairment, "
        "children and neonates are skipped so the figure is the ordinary adult one.",
        "A drug appears once per mode of administration. Descriptors, structure, target and the in-vitro "
        "numbers are properties of the molecule, so they repeat across its route rows; bioavailability, dose and "
        "the free concentration are properties of the route, so they differ.",
    ]

    # ------------------------------------------------------------ write
    out_json = os.path.join(a.site, "data", f"cohort_{g4}.json")
    out_csv = os.path.join(a.site, "data", f"cohort_{g4}.csv")
    out_md = os.path.join(a.site, "data", f"cohort_{g4}_assumptions.md")
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    meta = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "atc4": g4, "atc4_name": l4, "atc1_name": l1, "atc2_name": l2, "atc3_name": l3,
        "target": target, "target_name": tname, "n_drugs": len(drugs), "n_rows": len(rows),
        "max_routes": MAX_ROUTES, "iv_excluded_from_count": sorted(IV), "body_kg": BODY_KG,
        "formulas": {
            "therapeutic_index": "LOG10(in-vivo toxicity) - LOG10(1 / in-vivo activity)",
            "therapeutic_index_classical": "LOG10(in-vivo toxicity / in-vivo activity)",
            "free_concentration": "1.44 * F * half-life(h) * dose(mg) / dose interval(h)",
            "dose_corrected_bioavailability": "F / dose(mg)",
            "in_vivo_activity": f"WHO defined daily dose for the route, in mg, / {BODY_KG:.0f} kg",
        },
        "sources": {"cited_table": table_meta, "pubchem": PUG, "who_atc": who_url, "chembl": CHEMBL, "openfda": OPENFDA,
                    "dailymed": DAILYMED, "fda_route_legend": os.path.relpath(FDA_ROUTES, HERE),
                    "rdkit_qed": "rdkit.Chem.QED, Bickerton et al. 2012, mean weights"},
        "assumptions": assume,
    }
    json.dump({"meta": meta, "rows": rows}, open(out_json, "w", encoding="utf-8"), separators=(",", ":"))

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(SHEET_COLS + AUDIT_COLS)
        for r in rows:
            d = r["d"]
            g = lambda k: ("" if num(r[k]) is None else num(r[k]))
            w.writerow([
                r["cid"], r["name"], r["l1"], r["l2"], r["mechanism"], r["l4"], r["atc"],
                d["mw"], d["logp"], d["hbd"], d["hba"], d["tpsa"], d["rotb"], d["arom"], "",
                d["mr"], d["qed"], r["route"], r["route_other"], r["smiles"],
                f'{r["target"]} ({r["target_name"]})' if r["target"] else "",
                r["offtox"] if r["offtox"] is not None else "", r["act"] if r["act"] is not None else "",
                g("invivo_tox"), g("invivo_act"), r["ti"] if r["ti"] is not None else "",
                g("F"), g("t_half"), g("dose"), g("tau"),
                r["free_conc"] if r["free_conc"] is not None else "",
                r["endpoint"]["value"] or "",
                r["route_rank"] or "", r["route_evidence"], r["route_fda_code"], r["route_nci"],
                r["tox_kind"], r["tox_route"], r["tox_species"], r["rep_act"], r["rep_act_kind"],
                r["ti_classical"] if r["ti_classical"] is not None else "",
                r["F_per_mg"] if r["F_per_mg"] is not None else "",
                "; ".join(f for f in r["flags"] if "exposure" in f),
                r["ik"], r["chembl"] or "", d["qlim"],
                f'{r["offtox_target"]} ({r["offtox_name"]})' if r["offtox_target"] else "",
                r["act_n"] or "", d["fsp3"], d["heavy"], r["xlogp"] if r["xlogp"] is not None else "",
                r["F"]["evidence"], r["t_half"]["evidence"], r["invivo_tox"]["evidence"], r["dose"]["evidence"],
                "; ".join(r["flags"]),
            ])

    with open(out_md, "w", encoding="utf-8") as f:
        f.write(f"# {g4} {l4}: how this table was filled\n\n")
        f.write(f"Built {meta['generated_utc']} by `tools/build_cohort.py --atc4 {g4}`. {meta['n_drugs']} drugs, "
                f"{meta['n_rows']} rows, one per mode of administration.\n\n## Formulas\n\n")
        for k, v in meta["formulas"].items():
            f.write(f"- `{k}` = {v}\n")
        f.write("\n## Where each column comes from\n\n| Column | Source |\n|---|---|\n")
        for col, s in [
            ("Compound Identifier, Structure, PubChem XLogP3", "PubChem PUG REST, by generic name then by CID"),
            ("Anatomical / Therapeutic / Chemical Group, ATC code, Dosage", "the WHO ATC/DDD index page"),
            ("Mechanism of Action, Primary Biological Target", "ChEMBL mechanism records"),
            ("Molecular Weight through Molecular Refractivity, QED", "RDKit on the PubChem structure"),
            ("Mode of Administration", "openFDA label route counts, DailyMed SPL routeCode as the fallback"),
            ("In Vitro Activity, In Vitro Toxicity",
             "median ChEMBL pChEMBL at the primary target, and at the strongest other target"),
            ("Bioavailability, Half Life, In Vivo Toxicity, Primary Toxicity Endpoint",
             "read out of the US label text, with the sentence kept in the row, and where the text states "
             "nothing, from `tools/inputs/<group>_pk_tox.json`, which carries one cited sentence per cell"),
            ("In Vivo Activity", "the WHO defined daily dose for that route, in mg/kg"),
            ("Therapeutic Index, In Vivo Free Drug Concentration, Dose-corrected bioavailability, Exposure flag",
             "computed from the columns above by the formulas above"),
        ]:
            f.write(f"| {col} | {s} |\n")
        f.write("\n## Assumptions and choices\n\n")
        for s in assume:
            f.write(f"- {s}\n")
        f.write("\n## Empty cells\n\n")
        miss = defaultdict(list)
        for r in rows:
            for k, label in [("invivo_tox", "In Vivo Toxicity"), ("invivo_act", "In Vivo Activity"),
                             ("F", "Bioavailability"), ("t_half", "Half Life"), ("dose", "Dosage")]:
                if num(r[k]) is None:
                    miss[label].append(f"{r['name']} / {r['route']}")
            for k, label in [("act", "In Vitro Activity"), ("offtox", "In Vitro Toxicity")]:
                if r[k] is None:
                    miss[label].append(f"{r['name']} / {r['route']}")
        if miss:
            for label, who in sorted(miss.items()):
                f.write(f"- **{label}** is empty in {len(who)} row(s): {', '.join(who[:8])}"
                        f"{' and more' if len(who) > 8 else ''}\n")
        else:
            f.write("- none\n")

    prov = os.path.join(a.site, "data", "provenance.csv")
    new = not os.path.exists(prov)
    with open(prov, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["url", "status", "bytes", "utc", "cached"])
        for r in http.log:
            w.writerow([r["url"], r["status"], r["bytes"], r["utc"], r["cached"]])

    filled = sum(1 for r in rows if r["free_conc"] is not None)
    print(f"\n{len(rows)} rows for {len(drugs)} drugs -> {os.path.relpath(out_csv, HERE)}")
    print(f"free drug concentration in {filled}/{len(rows)} rows; "
          f"therapeutic index in {sum(1 for r in rows if r['ti'] is not None)}; "
          f"in-vitro activity in {sum(1 for r in rows if r['act'] is not None)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
