"""Europe PMC search and text capture.

A *capture* is the verbatim text we are allowed to quote from: the public abstract of any record, plus the
open-access full text (paragraphs and table rows) when Europe PMC serves the article XML. Each capture keeps
the block list with locators so quotes can be verified as exact substrings later.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from common import get, get_json

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"

ANIMAL_WORDS = re.compile(
    r"\b(rats?|mice|mouse|murine|dogs?|canine|cats?|feline|horses?|equine|equids?|ponies|cattle|cows?|bovine|calves|"
    r"sheep|ovine|goats?|caprine|pigs?|swine|porcine|piglets?|rabbits?|chickens?|broilers?|poultry|turkeys?|fish|"
    r"trout|salmon|monkeys?|macaques?|primates?|camels?|llamas?|alpacas?|elephants?|birds?|veterinary|in vitro|"
    r"microsom\w+|hepatocytes?|caco-2|zebrafish|hamsters?|guinea pigs?|ferrets?|dolphins?|reptiles?|snakes?|turtles?)\b",
    re.I)


HUMAN_WORDS = re.compile(r"\b(patients?|volunteers?|subjects?|humans?|men|women|adults?|children|infants?|neonates?|"
                         r"participants?|individuals|people|persons?|elderly|adolescents?|pregnan\w+|man|woman)\b", re.I)
POP_TAGS = [
    ("healthy volunteers", re.compile(r"\bhealthy\b|\bvolunteers?\b", re.I)),
    ("paediatric", re.compile(r"\b(children|child|p(a)?ediatric|infants?|neonat\w+|newborns?|adolescents?|preterm|toddlers?)\b", re.I)),
    ("elderly", re.compile(r"\b(elderly|older\s+(?:adults|patients|people)|geriatric|aged)\b", re.I)),
    ("pregnancy", re.compile(r"\b(pregnan\w+|lactat\w+|breast\s*milk|postpartum)\b", re.I)),
    ("renal impairment", re.compile(r"\b(renal\s+(?:impairment|failure|insufficiency|dysfunction|disease)|dialysis|h(a)?emodialysis|CKD|ESRD|kidney\s+(?:disease|failure|transplant))\b", re.I)),
    ("hepatic impairment", re.compile(r"\b(hepatic\s+(?:impairment|failure|insufficiency|dysfunction|disease)|cirrho\w+|liver\s+(?:disease|failure|transplant))\b", re.I)),
    ("critically ill", re.compile(r"\b(critically\s+ill|intensive\s+care|ICU|ECMO|sepsis|septic|terminally\s+ill|palliative)\b", re.I)),
    ("obesity", re.compile(r"\b(obes\w+|bariatric|morbidly)\b", re.I)),
    ("drug interaction", re.compile(r"\b(interactions?|co-?administ\w+|inhibitor\s+of\s+CYP|induc\w+\s+by|effects?\s+of\s+\w[\w-]*(?:\s+\w+)?\s+on\s+the\b|influence\s+of\s+\w+(?:\s+\w+)?\s+on)\b", re.I)),
    ("formulation study", re.compile(r"\b(formulation|nanoparticle|liposom\w+|bioequivalen\w+|generic|sustained[- ]release|extended[- ]release|transdermal|patch)\b", re.I)),
]


def population(rec: dict) -> list[str]:
    """Tags for the study population, from the title and abstract. Empty list = general adult/unspecified."""
    txt = (rec.get("title", "") + " " + rec.get("abstract", "")[:600])
    return [tag for tag, rx in POP_TAGS if rx.search(txt)]


def _q(s: str) -> str:
    return '"' + s.replace('"', "") + '"'


def query_ladder(drug: str, synonyms: list[str] | None = None) -> list[tuple[str, str, str | None]]:
    """(stage, query, sort) triples. Title must contain the drug (or a synonym) in every stage."""
    names = [drug] + [s for s in (synonyms or []) if s and s.lower() != drug.lower()]
    t = "(" + " OR ".join(f"TITLE:{_q(n)}" for n in names) + ")"
    pk = "(TITLE:pharmacokinetic* OR TITLE:\"clinical pharmacology\" OR TITLE:disposition OR TITLE:bioavailability OR TITLE:\"protein binding\")"
    params = "(ABSTRACT:clearance OR ABSTRACT:\"volume of distribution\" OR ABSTRACT:\"protein binding\" OR ABSTRACT:bioavailability OR ABSTRACT:\"half-life\" OR ABSTRACT:\"plasma concentration\")"
    return [
        ("title-pk", f"{t} AND {pk} AND SRC:MED", None),
        ("title-pk-cited", f"{t} AND {pk} AND SRC:MED", "CITED desc"),
        ("clinical-pk", f"{t} AND \"clinical pharmacokinetics\" AND SRC:MED", None),
        ("title-params", f"{t} AND {params} AND SRC:MED", None),
        ("title-params-cited", f"{t} AND {params} AND SRC:MED", "CITED desc"),
    ]


def search(query: str, page_size: int = 25, sort: str | None = None) -> list[dict]:
    params = {"query": query, "format": "json", "resultType": "core", "pageSize": page_size}
    if sort:
        params["sort"] = sort
    js = get_json(f"{EPMC}/search", params, kind="epmc_search")
    if not js:
        return []
    return js.get("resultList", {}).get("result", []) or []


def title_mentions(rec: dict, names: list[str]) -> bool:
    t = rec.get("title", "").lower()
    return any(n.lower() in t for n in names if n)


def record_summary(r: dict) -> dict:
    authors = r.get("authorList", {}).get("author", []) or []
    first = ""
    if authors:
        a = authors[0]
        first = a.get("lastName") or a.get("collectiveName") or (a.get("fullName") or "").split(" ")[0]
    return {
        "pmid": r.get("pmid"), "pmcid": r.get("pmcid"), "doi": (r.get("doi") or "").lower() or None,
        "title": (r.get("title") or "").strip(),
        "journal": (r.get("journalTitle") or ((r.get("journalInfo") or {}).get("journal") or {}).get("title")
                    or (r.get("bookOrReportDetails") or {}).get("publisher") or ""),
        "year": r.get("pubYear"), "first_author": first, "author_string": r.get("authorString", ""),
        "pub_type": r.get("pubTypeList", {}).get("pubType", []) if isinstance(r.get("pubTypeList"), dict) else [],
        "is_oa": r.get("isOpenAccess") == "Y", "in_epmc": r.get("inEPMC") == "Y",
        "abstract": (r.get("abstractText") or "").strip(),
        "cited_by": r.get("citedByCount", 0), "source": r.get("source"), "id": r.get("id"),
    }


def public_url(rec: dict) -> str:
    if rec.get("pmcid"):
        return f"https://europepmc.org/article/PMC/{rec['pmcid']}"
    if rec.get("pmid"):
        return f"https://europepmc.org/article/MED/{rec['pmid']}"
    if rec.get("doi"):
        return f"https://doi.org/{rec['doi']}"
    return ""


def is_animal_or_invitro(rec: dict) -> bool:
    """Drop records whose title names an animal / in-vitro system, or whose abstract is animal-only."""
    t = rec.get("title", "")
    if ANIMAL_WORDS.search(t):
        return True
    a = TAG_RE.sub("", rec.get("abstract", "") or "")
    animals = len(ANIMAL_WORDS.findall(a))
    humans = len(HUMAN_WORDS.findall(a))
    return animals > 0 and humans == 0


def block_is_animal(block: dict) -> bool:
    """Table/caption blocks whose own label or caption names an animal are not human evidence."""
    probe = block.get("section", "") + " " + (block.get("header", "") or "")
    if block["kind"] in ("table-row", "caption"):
        probe += " " + block["text"][:200]
    return bool(ANIMAL_WORDS.search(probe)) and not HUMAN_WORDS.search(probe)


TAG_RE = re.compile(r"<[^>]+>")


def clean_abstract(html: str) -> str:
    # Europe PMC abstracts may carry <h4>/<i>/<sub> tags; strip tags, keep text exactly otherwise.
    txt = TAG_RE.sub("", html)
    txt = txt.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    return re.sub(r"[ \t]+", " ", txt).strip()


def _text(el: ET.Element) -> str:
    return "".join(el.itertext())


def fulltext_blocks(pmcid: str) -> list[dict] | None:
    """Return paragraph and table-row blocks from the Europe PMC full-text XML, or None if unavailable."""
    r = get(f"{EPMC}/{pmcid}/fullTextXML", kind="epmc_fulltext")
    if r["status"] != 200 or not r["text"].strip():
        return None
    try:
        root = ET.fromstring(r["text"])
    except ET.ParseError:
        return None
    blocks: list[dict] = []
    body = root.find(".//body")
    if body is None:
        return None

    def walk(el: ET.Element, path: list[str]):
        for child in list(el):
            tag = child.tag.split("}")[-1]
            if tag == "sec":
                title_el = child.find("title")
                title = _text(title_el).strip() if title_el is not None else ""
                walk(child, path + ([title] if title else []))
            elif tag == "p":
                txt = re.sub(r"\s+", " ", _text(child)).strip()
                if len(txt) >= 40:
                    blocks.append({"kind": "paragraph", "section": " > ".join(path) or "Body", "text": txt})
            elif tag in ("table-wrap",):
                label = child.find("label")
                cap = child.find("caption")
                lab = _text(label).strip() if label is not None else "Table"
                capt = re.sub(r"\s+", " ", _text(cap)).strip() if cap is not None else ""
                header_rows = []
                for tr in child.iter():
                    if tr.tag.split("}")[-1] != "tr":
                        continue
                    cells = [re.sub(r"\s+", " ", _text(c)).strip() for c in tr if c.tag.split("}")[-1] in ("td", "th")]
                    if not any(cells):
                        continue
                    row_txt = " | ".join(cells)
                    is_header = all(c.tag.split("}")[-1] == "th" for c in tr if c.tag.split("}")[-1] in ("td", "th"))
                    if is_header:
                        header_rows.append(row_txt)
                    blocks.append({"kind": "table-row", "section": f"{lab}: {capt}".strip(": "),
                                   "text": row_txt, "header": " || ".join(header_rows[-2:])})
            elif tag in ("fig",):
                cap = child.find("caption")
                if cap is not None:
                    txt = re.sub(r"\s+", " ", _text(cap)).strip()
                    if len(txt) >= 40:
                        blocks.append({"kind": "caption", "section": " > ".join(path) or "Body", "text": txt})
            else:
                walk(child, path)

    walk(body, [])
    return blocks


def capture(rec: dict, want_fulltext: bool) -> dict:
    """Assemble the quotable text for one record."""
    blocks = []
    abs_txt = clean_abstract(rec.get("abstract", ""))
    if abs_txt:
        blocks.append({"kind": "abstract", "section": "Abstract", "text": abs_txt})
    access = "abstract (public record)"
    if want_fulltext and rec.get("pmcid") and (rec.get("is_oa") or rec.get("in_epmc")):
        fb = fulltext_blocks(rec["pmcid"])
        if fb:
            blocks.extend(fb)
            access = "open-access full text (Europe PMC)"
    for i, b in enumerate(blocks):
        b["id"] = f"b{i:04d}"
    return {"blocks": blocks, "access": access}
