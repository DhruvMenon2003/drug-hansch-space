"""Regex extraction of pharmacokinetic statements from captured text, with unit normalisation.

Each hit keeps the exact sentence (a verbatim substring of the block it came from), the reported number and
unit, the value converted to the workbook unit, and the assumption used for the conversion. Nothing here
rewrites source text; quotes are sliced from the block string.

Workbook units (sheet notes): Vss in L/kg, clearance in mL/min/kg, dosage in ug, dose interval in min,
fraction absorbed and fraction unbound as fractions, therapeutic/toxic levels in whatever concentration unit
the source uses (only their ratio enters the Log TI).
"""

from __future__ import annotations

import re

from common import BODY_WEIGHT_KG, sig

NUM = r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)"
RANGE = r"(?P<lo>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:[-–—−]|to|and)\s*(?P<hi>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
PM = r"(?:\s*(?:±|\+/-|\(SD)?\s*\d+(?:\.\d+)?\)?)?"
SEP = r"\s*(?:/|per|·|\.|\s)\s*"
DASH1 = r"(?:\s*(?:-|−|–|⁻)\s*1|\s*\^?-1)"

# ---- unit vocabularies -------------------------------------------------------------------------------
# Order matters only for ties; _scan_units keeps the longest unit match at each number position.
D1 = r"(?:" + DASH1 + r")?"
PER70 = r"(?:" + SEP + r"|\s*(?:per|/)\s*)70\s*kg" + D1   # "/70 kg", ".70 kg-1", "per 70 kg"
NOKG = r"(?![\s/·.\-−–⁻]*(?:1\s*[./·]?\s*)?(?:\d+\s*)?kg)"
CL_UNITS = {
    "L/h/70kg": r"[lL](?:iters?|itres?)?" + SEP + r"h(?:r|our)?s?" + D1 + PER70,
    "mL/min/70kg": r"m[lL]" + SEP + r"min(?:ute)?s?" + D1 + PER70,
    "mL/min/kg": r"m[lL]" + SEP + r"min" + D1 + SEP + r"kg" + D1 + r"|m[lL]" + SEP + r"kg" + SEP + r"min|m[lL]" + SEP + r"min\s*(?:per|/)\s*kg",
    "L/h/kg": r"[lL](?:iters?|itres?)?" + SEP + r"h(?:r|our)?s?" + D1 + SEP + r"kg" + D1 + r"|[lL]" + SEP + r"kg" + SEP + r"h(?:r|our)?s?",
    "mL/h/kg": r"m[lL]" + SEP + r"h(?:r|our)?s?" + D1 + SEP + r"kg" + D1 + r"|m[lL]" + SEP + r"kg" + SEP + r"h(?:r|our)?s?",
    "mL/min": r"m[lL]" + SEP + r"min(?:ute)?s?" + D1 + r"(?![\s/·.]*(?:kg|1\.73|\d+\s*kg))",
    "L/h": r"[lL](?:iters?|itres?)?" + SEP + r"h(?:r|our)?s?" + D1 + NOKG,
    "L/min": r"[lL](?:iters?|itres?)?" + SEP + r"min(?:ute)?s?" + D1 + NOKG,
}
V_UNITS = {
    "L/70kg": r"[lL](?:iters?|itres?)?" + PER70,
    "L/kg": r"[lL](?:iters?|itres?)?" + SEP + r"kg" + D1,
    "mL/kg": r"m[lL]" + SEP + r"kg" + D1,
    "L": r"(?:[lL]|liters?|litres?)(?![\s/·.\-−–⁻]*(?:kg|h\b|hr|min|\d+\s*kg))",
}
CONC_UNITS = r"(?P<unit>mg/L|mg/l|µg/mL|μg/mL|ug/mL|mcg/mL|µg/ml|μg/ml|ug/ml|mcg/ml|ng/mL|ng/ml|µg/L|μg/L|ug/L|mcg/L|mmol/L|mEq/L|meq/L|nmol/L|µmol/L|μmol/L|umol/L|µmol/l|ng/L|pg/mL|IU/mL|U/mL)"

CL_WORD = re.compile(r"\b(?:clearance|CL\s*/\s*F|CL\s*\(?(?:tot|ss|p|s|t)?\)?|Cl\b|CLtot|CLs\b|CLp\b|CLss\b|CL/F)", re.I)
CL_BAD = re.compile(r"\b(renal|creatinine|intrinsic|hepatic|non-?renal|biliary|metabolic|unbound|formation|dialy\w+|haemodialysis|hemodialysis|CLr|CLcr|CLint|mucociliary|extrarenal|partial|free)\b", re.I)
V_WORD = re.compile(r"\b(?:volume\s+of\s+distribution|distribution\s+volume|V\s*ss|Vss|Vdss|V\s*\(?\s*ss\s*\)?|Vd\b|V\s*d\b|V\s*\(?d\)?|Vz\b|V\s*β|Vbeta|Varea|V\s*/\s*F|Vd/F|Vz/F|Vss/F|apparent\s+volume)", re.I)
V_BAD = re.compile(r"\b(central|peripheral|Vc\b|V1\b|V2\b|initial|blood|plasma\s+volume|compartment)\b", re.I)
PB_WORD = re.compile(r"\b(protein[- ]?bound|protein[- ]?binding|bound\s+to\s+(?:plasma|serum|human)\s+proteins?|plasma[- ]?binding|unbound|fraction\s+unbound|free\s+fraction|fu\b|albumin)\b", re.I)
F_WORD = re.compile(r"\bbioavailab\w+|\bF\s*=|\babsolute\s+(?:oral\s+)?availability|\bsystemic(?:ally)?\s+availab\w+|\boral\s+availability", re.I)

PCT = r"(?P<num>\d+(?:\.\d+)?)\s*%"
PCT_RANGE = r"(?P<lo>\d+(?:\.\d+)?)\s*%?\s*(?:[-–—−]|to|and)\s*(?P<hi>\d+(?:\.\d+)?)\s*%"

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\[\d])")


def sentences(text: str) -> list[tuple[int, str]]:
    """Split block text into sentences; each returned with its char offset in the block."""
    out = []
    pos = 0
    for s in SENT_SPLIT.split(text):
        if not s:
            continue
        idx = text.find(s, pos)
        if idx < 0:
            idx = pos
        out.append((idx, s))
        pos = idx + len(s)
    return out


def _num(s: str) -> float:
    """'3,958.4' and '1,260' are thousands-separated; '5,3' is a decimal comma."""
    if re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", s):
        return float(s.replace(",", ""))
    return float(s.replace(",", "."))


def _mean_range(m) -> float | None:
    g = m.groupdict()
    if g.get("lo") and g.get("hi"):
        lo, hi = _num(g["lo"]), _num(g["hi"])
        return (lo + hi) / 2 if lo <= hi else None
    if g.get("num"):
        return _num(g["num"])
    return None


WEIGHT_RE = re.compile(r"(?:weigh\w*\s+(?:of\s+)?|normali[sz]ed\s+to\s+(?:a\s+)?|standardi[sz]ed\s+to\s+(?:a\s+)?|scaled\s+to\s+(?:a\s+)?|per\s+|for\s+a\s+|in\s+a\s+|typical\s+)(?P<w>\d{2,3}(?:\.\d+)?)\s*(?:-\s*)?kg\b"
                       r"|(?P<w2>\d{2,3}(?:\.\d+)?)\s*(?:-\s*)?kg\s+(?:adult|patient|person|individual|subject|man|woman|body\s*weight)", re.I)


def stated_weight(sentence: str) -> float | None:
    """Body weight the sentence itself states (e.g. 'a typical patient weighing 40 kg'), if any."""
    for m in WEIGHT_RE.finditer(sentence):
        w = float(m.group("w") or m.group("w2"))
        if 2 <= w <= 200:
            return w
    return None


def norm_cl(value: float, unit: str, weight: float | None = None) -> tuple[float, str]:
    w = weight or BODY_WEIGHT_KG
    why = "weight stated in the sentence" if weight else "assumed adult weight"
    if unit == "mL/min/kg":
        return value, "as reported"
    if unit == "L/h/70kg":
        return value * 1000 / 60 / 70, "L/h per 70 kg × 1000/60 ÷ 70"
    if unit == "mL/min/70kg":
        return value / 70, "mL/min per 70 kg ÷ 70"
    if unit == "L/h/kg":
        return value * 1000 / 60, "L/h/kg × 1000/60"
    if unit == "mL/h/kg":
        return value / 60, "mL/h/kg ÷ 60"
    if unit == "mL/min":
        return value / w, f"mL/min ÷ {w:g} kg ({why})"
    if unit == "L/h":
        return value * 1000 / 60 / w, f"L/h × 1000/60 ÷ {w:g} kg ({why})"
    if unit == "L/min":
        return value * 1000 / w, f"L/min × 1000 ÷ {w:g} kg ({why})"
    raise ValueError(unit)


def norm_v(value: float, unit: str, weight: float | None = None) -> tuple[float, str]:
    w = weight or BODY_WEIGHT_KG
    why = "weight stated in the sentence" if weight else "assumed adult weight"
    if unit == "L/kg":
        return value, "as reported"
    if unit == "L/70kg":
        return value / 70, "L per 70 kg ÷ 70"
    if unit == "mL/kg":
        return value / 1000, "mL/kg ÷ 1000"
    if unit == "L":
        return value / w, f"L ÷ {w:g} kg ({why})"
    raise ValueError(unit)


def _plausible(param: str, v: float) -> bool:
    return {"CL": 0.005 <= v <= 400, "Vss": 0.02 <= v <= 100, "fu": 0.0005 <= v <= 1.0, "F": 0.005 <= v <= 1.0,
            "dose_ug": 0.1 <= v <= 1e8, "interval_min": 5 <= v <= 43200,
            "ther_min": v > 0, "tox_min": v > 0}.get(param, True)


def _hit(param, sentence, value_reported, unit_reported, value_norm, unit_norm, note, kind="", conf=1.0):
    return {"param": param, "sentence": sentence, "reported": value_reported, "reported_unit": unit_reported,
            "value": sig(value_norm, 3), "unit": unit_norm, "normalisation": note, "subtype": kind, "confidence": conf}


def _scan_units(sentence: str, units: dict, word_re, bad_re, normaliser, param: str, workbook_unit: str,
                subtype_fn=None) -> list[dict]:
    hits = []
    if not word_re.search(sentence):
        return hits
    found: dict[int, tuple[int, str, re.Match]] = {}
    for uname, upat in units.items():
        pat = re.compile(r"(?:" + RANGE + r"|" + NUM + r")" + PM + r"\s*(?:" + upat + r")(?![\w/])")
        for m in pat.finditer(sentence):
            prev = found.get(m.start())
            if prev is None or m.end() > prev[0]:
                found[m.start()] = (m.end(), uname, m)
    for _, (end, uname, m) in sorted(found.items()):
        if True:
            # context window before the number: look for the keyword and reject excluded qualifiers
            before = sentence[max(0, m.start() - 120):m.start()]
            after = sentence[m.end():m.end() + 60]
            ctx = before + " " + after
            kw = list(word_re.finditer(before)) or list(word_re.finditer(after))
            if not kw:
                continue
            # nearest keyword to the number; check qualifiers right before it
            nearest = kw[-1] if word_re.search(before) else kw[0]
            qual = before[max(0, nearest.start() - 40):nearest.start()] if word_re.search(before) else after[:nearest.start()]
            if bad_re.search(qual) or bad_re.search(before[-50:]):
                continue
            v = _mean_range(m)
            if v is None:
                continue
            try:
                vn, note = normaliser(v, uname, stated_weight(sentence))
            except ValueError:
                continue
            if not _plausible(param, vn):
                continue
            kind = subtype_fn(ctx) if subtype_fn else ""
            conf = 1.0 if m.groupdict().get("num") else 0.9
            if "F" in kind:
                conf -= 0.2
            hits.append(_hit(param, sentence, m.group(0).strip(), uname, vn, workbook_unit, note, kind, conf))
    return hits


def _cl_subtype(ctx: str) -> str:
    if re.search(r"CL\s*/\s*F|apparent\s+(?:oral\s+)?clearance|oral\s+clearance", ctx, re.I):
        return "CL/F (apparent oral)"
    if re.search(r"total|systemic|plasma|body", ctx, re.I):
        return "systemic CL"
    return "CL"


def _v_subtype(ctx: str) -> str:
    if re.search(r"/\s*F|V\s*d\s*/\s*F|Vz/F|Vss/F", ctx):
        return "V/F (apparent oral)"
    if re.search(r"steady[- ]state|Vss|V\s*\(?ss", ctx, re.I):
        return "Vss"
    if re.search(r"Vz|Vβ|Vbeta|Varea|terminal", ctx, re.I):
        return "Vz"
    return "Vd"


def extract_pb(sentence: str) -> list[dict]:
    hits = []
    if not PB_WORD.search(sentence):
        return hits
    # unbound fraction as a fraction (fu = 0.12)
    for m in re.finditer(r"(?:fraction\s+unbound|unbound\s+fraction|free\s+fraction|fu)\s*(?:\(fu\))?\s*(?:in\s+plasma\s*)?(?:of|was|were|is|=|:|averaged|approximately|about|~)?\s*(?:approximately|about|~)?\s*(?P<num>0?\.\d+)\b", sentence, re.I):
        v = _num(m.group("num"))
        if _plausible("fu", v):
            hits.append(_hit("fu", sentence, m.group("num"), "fraction", v, "fraction", "as reported", "fu", 1.0))
    # unbound percentage
    for m in re.finditer(r"(?:" + PCT_RANGE + r"|" + PCT + r")\s*(?:of\s+(?:the\s+)?drug\s+)?(?:is\s+|was\s+|were\s+|remains?\s+)?(?:unbound|free)\b", sentence, re.I):
        v = _mean_range(m)
        if v is not None and _plausible("fu", v / 100):
            hits.append(_hit("fu", sentence, m.group(0).strip(), "% unbound", v / 100, "fraction", "% unbound ÷ 100", "fu", 0.95))
    for m in re.finditer(r"(?:unbound|free)\s+(?:fraction|percentage|portion)\s*(?:of|was|is|=|:|averaged|approximately|about)?\s*(?:approximately|about|~)?\s*(?:" + PCT_RANGE + r"|" + PCT + r")", sentence, re.I):
        v = _mean_range(m)
        if v is not None and _plausible("fu", v / 100):
            hits.append(_hit("fu", sentence, m.group(0).strip(), "% unbound", v / 100, "fraction", "% unbound ÷ 100", "fu", 0.95))
    # bound percentage -> fu = 1 - pb
    bound_pats = [
        r"(?:" + PCT_RANGE + r"|" + PCT + r")\s*(?:of\s+(?:the\s+)?(?:drug|dose|\w+)\s+)?(?:is\s+|was\s+|were\s+|are\s+|being\s+)?(?:protein[- ]?)?bound(?!\s+fraction)",
        r"(?:protein[- ]?binding|plasma[- ]?protein[- ]?binding|binding\s+to\s+(?:plasma|serum|human)\s+proteins?)\s*(?:of\s+\w+\s+)?(?:\(\w+\)\s*)?(?:was|were|is|are|of|=|:|averaged|averages|ranged\s+from|ranges\s+from|approximately|about|~|high\s*\()?\s*(?:approximately|about|~|high\s*\()?\s*(?:" + PCT_RANGE + r"|" + PCT + r")",
        r"bound\s+to\s+(?:plasma|serum|human|human\s+plasma)\s+proteins?\s*(?:\(|to\s+the\s+extent\s+of|at|by|is|was|,)?\s*(?:approximately|about|~)?\s*(?:" + PCT_RANGE + r"|" + PCT + r")",
        r"(?:" + PCT_RANGE + r"|" + PCT + r")\s*(?:plasma[- ]?)?protein[- ]?(?:binding|bound)",
    ]
    for bp in bound_pats:
        for m in re.finditer(bp, sentence, re.I):
            v = _mean_range(m)
            if v is None or v >= 100 or v < 0:
                continue
            fu = (100 - v) / 100
            if _plausible("fu", fu):
                hits.append(_hit("fu", sentence, m.group(0).strip(), "% bound", fu, "fraction", "fu = 1 − (% bound ÷ 100)", "from protein binding", 0.9))
    return hits


def extract_f(sentence: str) -> list[dict]:
    hits = []
    if not F_WORD.search(sentence):
        return hits
    pats = [
        r"(?:absolute\s+|oral\s+|systemic\s+|mean\s+|average\s+)*bioavailab\w+\s*(?:\(F\)\s*)?(?:of\s+\w+\s+)?(?:was|were|is|are|of|=|:|averaged|averages|approximately|about|~|ranged\s+from|ranges\s+from|estimated\s+(?:at|to\s+be)|reported\s+(?:as|to\s+be)|only|around|close\s+to|reaches|reached|approaches|exceeds|approximately|low\s*\(|high\s*\(|\()?\s*(?:approximately|about|~|only|around)?\s*(?:" + PCT_RANGE + r"|" + PCT + r")",
        r"(?:" + PCT_RANGE + r"|" + PCT + r")\s*(?:absolute\s+|oral\s+|systemic\s+)?(?:bioavailab\w+|systemically\s+available|availability)",
        r"bioavailab\w+\s*(?:\(F\)\s*)?(?:of|was|is|=|:)\s*(?:approximately|about|~)?\s*(?P<num>0?\.\d+)\b(?!\s*%)",
        r"\bF\s*=\s*(?P<num>0?\.\d+)\b",
    ]
    for i, bp in enumerate(pats):
        for m in re.finditer(bp, sentence, re.I):
            g = m.groupdict()
            v = _mean_range(m)
            if v is None:
                continue
            if i >= 2:
                f = v
                rep_unit = "fraction"
                note = "as reported"
            else:
                f = v / 100
                rep_unit = "%"
                note = "% ÷ 100"
            if _plausible("F", f):
                hits.append(_hit("F", sentence, m.group(0).strip(), rep_unit, f, "fraction", note, "bioavailability", 0.9))
    return hits


DOSE_RE = re.compile(r"(?P<dose>\d+(?:\.\d+)?)\s*(?P<du>mg|g|µg|μg|mcg|ug)(?P<perkg>\s*/\s*kg|\s*per\s+kg)?(?:\s*(?:of\s+\w+\s+)?(?:body\s*weight)?)?"
                     r"(?:[^.;%]{0,60}?)(?:(?:every|each|q)\s*(?P<h>\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?|hourly)\b|"
                     r"(?P<freq>once[- ]daily|once\s+a\s+day|once\s+per\s+day|twice[- ]daily|twice\s+a\s+day|three\s+times\s+(?:a\s+|per\s+)?day|three\s+times\s+daily|four\s+times\s+(?:a\s+|per\s+)?day|four\s+times\s+daily|\bq\.?d\.?\b|\bo\.?d\.?\b|\bb\.?i\.?d\.?\b|\bt\.?i\.?d\.?\b|\bq\.?i\.?d\.?\b|\bq\d+h\b|daily|\bQD\b|\bBID\b|\bTID\b|\bQID\b))",
                     re.I)
FREQ_MIN = {"once": 1440, "daily": 1440, "qd": 1440, "od": 1440, "twice": 720, "bid": 720, "three": 480, "tid": 480, "four": 360, "qid": 360}


def extract_dose(sentence: str, names: list[str] | None = None) -> list[dict]:
    hits = []
    if not re.search(r"\b(dose|doses|dosage|dosing|regimen|administered|administration|received|given|mg)\b", sentence, re.I):
        return hits
    if re.search(r"simulat|\bFig\.?\b|figure|hypothetical|\bwould\b|\bcould\b|\bshould\b|\bif\b|scenario|predicted", sentence, re.I):
        return hits
    for m in DOSE_RE.finditer(sentence):
        if names:  # the dose must sit next to this drug's name, not another drug's in the same sentence
            window = sentence[max(0, m.start() - 40):m.end() + 5].lower()
            if not any(n.lower() in window for n in names):
                continue
        d = _num(m.group("dose"))
        du = m.group("du").lower()
        mult = {"mg": 1000.0, "g": 1e6, "µg": 1.0, "μg": 1.0, "mcg": 1.0, "ug": 1.0}[du]
        note = f"{du} → µg"
        if m.group("perkg"):
            mult *= BODY_WEIGHT_KG
            note += f"; per kg × {BODY_WEIGHT_KG:g} kg (assumed adult weight)"
        dose_ug = d * mult
        interval = None
        if m.group("h"):
            interval = _num(m.group("h")) * 60
            inote = "hours × 60"
        else:
            f = (m.group("freq") or "").lower().replace(".", "").replace("-", " ")
            key = f.split(" ")[0] if f else ""
            mq = re.match(r"q(\d+)h", f)
            if mq:
                interval = int(mq.group(1)) * 60
                inote = "qNh → N × 60"
            elif key in FREQ_MIN:
                interval = FREQ_MIN[key]
                inote = f"'{m.group('freq')}' → {FREQ_MIN[key]} min"
        if not _plausible("dose_ug", dose_ug):
            continue
        hits.append(_hit("dose_ug", sentence, f"{m.group('dose')} {m.group('du')}{m.group('perkg') or ''}", du, dose_ug, "µg", note, "regimen", 0.7))
        if interval and _plausible("interval_min", interval):
            hits.append(_hit("interval_min", sentence, (m.group("h") and m.group("h") + " h") or m.group("freq"), "schedule", interval, "min", inote, "regimen", 0.7))
    return hits


def extract_levels(sentence: str) -> list[dict]:
    hits = []
    ther = re.compile(r"therapeutic\s+(?:plasma\s+|serum\s+|blood\s+|drug\s+|target\s+)?(?:concentration|level|range|window|interval)s?\s*(?:of\s+\w+\s+)?(?:\((?:TR|TI)\)\s*)?(?:is|was|were|are|of|:|=|between|from|lies?\s+between|ranges?\s+(?:from|between)|generally|usually|considered|defined\s+as|approximately|about|~|,)?\s*(?:considered\s+(?:to\s+be\s+)?)?(?:approximately|about|~|between)?\s*" + RANGE + r"\s*" + CONC_UNITS, re.I)
    for m in ther.finditer(sentence):
        lo, hi = _num(m.group("lo")), _num(m.group("hi"))
        if lo <= 0 or hi <= lo:
            continue
        hits.append(_hit("ther_min", sentence, f"{m.group('lo')}–{m.group('hi')} {m.group('unit')}", m.group("unit"), lo, m.group("unit"), "lower bound of therapeutic range", "range", 0.9))
        hits.append(_hit("ther_max", sentence, f"{m.group('lo')}–{m.group('hi')} {m.group('unit')}", m.group("unit"), hi, m.group("unit"), "upper bound of therapeutic range", "range", 0.9))
    tox = re.compile(r"tox\w*\s+(?:effects?|symptoms?|reactions?|concentrations?|levels?|range|threshold)?\s*(?:(?:is|are|was|were|occur\w*|seen|observed|reported|appear\w*|likely|expected|develop\w*|associated|generally|usually|may\s+occur|can\s+occur)\s*)*(?:with\s+|at\s+|above\s+|when\s+|beyond\s+|exceed\w*\s+|greater\s+than\s+|higher\s+than\s+|more\s+than\s+|>\s*|over\s+|in\s+excess\s+of\s+)+(?:plasma\s+|serum\s+|blood\s+)?(?:concentrations?|levels?)?\s*(?:of\s+|above\s+|exceeding\s+|greater\s+than\s+|>\s*|over\s+)*(?:approximately|about|~)?\s*(?P<num>\d+(?:\.\d+)?)\s*" + CONC_UNITS, re.I)
    for m in tox.finditer(sentence):
        v = _num(m.group("num"))
        if v > 0:
            hits.append(_hit("tox_min", sentence, f"{m.group('num')} {m.group('unit')}", m.group("unit"), v, m.group("unit"), "concentration above which toxicity is reported", "threshold", 0.85))
    tox2 = re.compile(r"(?:concentrations?|levels?)\s+(?:above|exceeding|greater\s+than|higher\s+than|over|>)\s*(?:approximately|about|~)?\s*(?P<num>\d+(?:\.\d+)?)\s*" + CONC_UNITS + r"[^.]{0,80}?\btox", re.I)
    for m in tox2.finditer(sentence):
        v = _num(m.group("num"))
        if v > 0:
            hits.append(_hit("tox_min", sentence, f"{m.group('num')} {m.group('unit')}", m.group("unit"), v, m.group("unit"), "concentration above which toxicity is reported", "threshold", 0.8))
    return hits


def extract_table_row(block: dict) -> list[dict]:
    """Table rows look like 'CL (mL/min/kg) | 5.2 ± 1.1 | 4.9 ± 0.8'. Unit sits in the label cell."""
    txt = block["text"]
    cells = [c.strip() for c in txt.split("|")]
    if len(cells) < 2:
        return []
    label = cells[0]
    header = block.get("header", "")
    hits = []
    first_num = None
    for c in cells[1:]:
        m = re.match(r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?:\s*(?:±|\(|\[|,|\s))?", c)
        if m:
            first_num = _num(m.group("num"))
            rep = c
            break
    if first_num is None:
        return []
    lab_unit = label + " " + header
    for uname, upat in CL_UNITS.items():
        if CL_WORD.search(label) and not CL_BAD.search(label) and re.search(r"\(?\s*(?:" + upat + r")\s*\)?", lab_unit):
            try:
                vn, note = norm_cl(first_num, uname)
            except ValueError:
                continue
            if _plausible("CL", vn):
                hits.append(_hit("CL", txt, rep, uname, vn, "mL/min/kg", note + " (table row; first numeric cell)", _cl_subtype(label), 0.8))
            break
    for uname, upat in V_UNITS.items():
        if V_WORD.search(label) and not V_BAD.search(label) and re.search(r"\(?\s*(?:" + upat + r")\s*\)?", lab_unit):
            try:
                vn, note = norm_v(first_num, uname)
            except ValueError:
                continue
            if _plausible("Vss", vn):
                hits.append(_hit("Vss", txt, rep, uname, vn, "L/kg", note + " (table row; first numeric cell)", _v_subtype(label), 0.8))
            break
    if re.search(r"\bfu\b|unbound\s+fraction|fraction\s+unbound", label, re.I) and 0 < first_num <= 1:
        hits.append(_hit("fu", txt, rep, "fraction", first_num, "fraction", "table row; first numeric cell", "fu", 0.8))
    elif re.search(r"protein\s+binding|%\s*bound|bound\s*\(%\)", lab_unit, re.I) and 0 < first_num < 100:
        hits.append(_hit("fu", txt, rep, "% bound", (100 - first_num) / 100, "fraction", "fu = 1 − (% bound ÷ 100) (table row)", "from protein binding", 0.75))
    if re.search(r"\bF\b\s*\(?%|bioavailab", lab_unit, re.I) and 0 < first_num <= 100:
        f = first_num / 100 if first_num > 1 else first_num
        hits.append(_hit("F", txt, rep, "%" if first_num > 1 else "fraction", f, "fraction", "table row; first numeric cell", "bioavailability", 0.75))
    return hits


MAX_SENTENCE = 700


def extract_block(block: dict, names: list[str] | None = None) -> list[dict]:
    """All PK hits in one capture block, each carrying its sentence and locator."""
    out = []
    if block.get("animal"):
        return out
    if block["kind"] == "table-row":
        for h in extract_table_row(block):
            h["locator"] = f"{block['section']} — row starting “{block['text'][:40]}”"
            h["block"] = block["id"]
            out.append(h)
        return out
    for off, s in sentences(block["text"]):
        if len(s) > MAX_SENTENCE:  # crammed table-as-paragraph text is not a quotable sentence
            continue
        hits = []
        hits += _scan_units(s, CL_UNITS, CL_WORD, CL_BAD, norm_cl, "CL", "mL/min/kg", _cl_subtype)
        hits += _scan_units(s, V_UNITS, V_WORD, V_BAD, norm_v, "Vss", "L/kg", _v_subtype)
        hits += extract_pb(s)
        hits += extract_f(s)
        hits += extract_dose(s, names)
        hits += extract_levels(s)
        for h in hits:
            words = " ".join(s.split()[:6])
            h["locator"] = f"{block['section']} — sentence starting “{words}”"
            h["block"] = block["id"]
            h["offset"] = off
            out.append(h)
    return out
