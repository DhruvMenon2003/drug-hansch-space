"""Identifier lookups.

PubChem   → CID, SMILES, DrugBank ID (synonym list)
Open Targets (mirrors ChEMBL drug mechanisms) → ChEMBL ID, DrugBank cross-reference, mechanism label
            ("<target> <action>"), UniProt Swiss-Prot accessions of the target components
ChEMBL web services → fallback for the mechanism when Open Targets has no record
"""

from __future__ import annotations

import re
from urllib.parse import quote

from common import get_json, post_json

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
OT = "https://api.platform.opentargets.org/api/v4/graphql"
# ChEMBL web services answered with HTTP 500 / 20-60 s timeouts throughout the 2026-11-08 run; Open Targets
# serves the same ChEMBL mechanism data, so the fallback is off by default (set to True to re-enable).
USE_CHEMBL_FALLBACK = False

OT_SEARCH = "query($q:String!){search(queryString:$q,entityNames:[\"drug\"],page:{index:0,size:5}){hits{id name entity}}}"
OT_DRUG = ("query($id:String!){drug(chemblId:$id){id name crossReferences{source ids} "
           "mechanismsOfAction{rows{mechanismOfAction actionType targetName targets{id approvedSymbol approvedName "
           "proteinIds{id source}}}}}}")


def pubchem(name: str) -> dict:
    out = {"cid": None, "smiles": None, "drugbank": None, "pubchem_title": None}
    js = get_json(f"{PUG}/compound/name/{quote(name)}/property/SMILES,ConnectivitySMILES,Title/JSON", kind="pubchem")
    props = (js or {}).get("PropertyTable", {}).get("Properties", []) if js else []
    if not props:
        return out
    p = props[0]
    out["cid"] = p.get("CID")
    out["smiles"] = p.get("SMILES") or p.get("ConnectivitySMILES")
    out["pubchem_title"] = p.get("Title")
    syn = get_json(f"{PUG}/compound/cid/{out['cid']}/synonyms/JSON", kind="pubchem")
    if syn:
        for s in syn.get("InformationList", {}).get("Information", [{}])[0].get("Synonym", []):
            if re.fullmatch(r"DB\d{5}", s):
                out["drugbank"] = s
                break
    return out


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def opentargets(name: str, alt_names: list[str]) -> dict:
    out = {"chembl_id": None, "ot_name": None, "drugbank": None, "targets": [], "uniprot": [], "mechanisms": []}
    wanted = {_norm(n) for n in [name] + alt_names if n}
    pick = None
    for q in [name] + [a for a in alt_names if a and a.lower() != name.lower()]:
        js = post_json(OT, {"query": OT_SEARCH, "variables": {"q": q}}, kind="opentargets")
        hits = ((js or {}).get("data") or {}).get("search", {}).get("hits", []) if js else []
        pick = next((h for h in hits if _norm(h["name"]) in wanted), None)
        if pick:
            break
    if pick is None:
        return out
    out["chembl_id"], out["ot_name"] = pick["id"], pick["name"]
    js = post_json(OT, {"query": OT_DRUG, "variables": {"id": pick["id"]}}, kind="opentargets")
    d = ((js or {}).get("data") or {}).get("drug") if js else None
    if not d:
        return out
    for xr in d.get("crossReferences") or []:
        if xr.get("source", "").lower() == "drugbank" and xr.get("ids"):
            out["drugbank"] = xr["ids"][0]
    for row in (d.get("mechanismsOfAction") or {}).get("rows", []) or []:
        label = row.get("mechanismOfAction") or f"{row.get('targetName', '')} {str(row.get('actionType') or '').lower()}".strip()
        accs = []
        for t in row.get("targets") or []:
            for pid in t.get("proteinIds") or []:
                if pid.get("source") == "uniprot_swissprot" and pid["id"] not in accs:
                    accs.append(pid["id"])
        out["mechanisms"].append({"mechanism": label, "action": row.get("actionType"), "target_name": row.get("targetName"),
                                  "symbols": [t.get("approvedSymbol") for t in row.get("targets") or []], "uniprot": accs})
        if label and label not in out["targets"]:
            out["targets"].append(label)
        for a in accs:
            if a not in out["uniprot"]:
                out["uniprot"].append(a)
    return out


def chembl_fallback(name: str) -> dict:
    out = {"chembl_id": None, "targets": [], "uniprot": [], "mechanisms": []}
    kw = {"timeout": 20, "retries": 1}  # ChEMBL web services have been slow/500 during this run; fail fast
    js = get_json(f"{CHEMBL}/molecule/search.json", {"q": name, "limit": 5}, kind="chembl", **kw)
    mols = (js or {}).get("molecules", []) if js else []
    pick = next((m for m in mols if (m.get("pref_name") or "").lower() == name.lower()), mols[0] if mols else None)
    if pick is None:
        return out
    out["chembl_id"] = pick.get("molecule_chembl_id")
    out["chembl_pref_name"] = pick.get("pref_name")
    mech = get_json(f"{CHEMBL}/mechanism.json", {"molecule_chembl_id": out["chembl_id"], "limit": 20}, kind="chembl", **kw)
    for m in (mech or {}).get("mechanisms", []):
        tid = m.get("target_chembl_id")
        entry = {"mechanism": m.get("mechanism_of_action"), "action": m.get("action_type"), "target_name": None, "uniprot": []}
        if tid:
            t = get_json(f"{CHEMBL}/target/{tid}.json", kind="chembl", **kw)
            if t:
                entry["target_name"] = t.get("pref_name")
                entry["uniprot"] = [c.get("accession") for c in t.get("target_components", []) or [] if c.get("accession")]
        out["mechanisms"].append(entry)
        if entry["mechanism"] and entry["mechanism"] not in out["targets"]:
            out["targets"].append(entry["mechanism"])
        for u in entry["uniprot"]:
            if u not in out["uniprot"]:
                out["uniprot"].append(u)
    return out


def lookup(name: str) -> dict:
    pc = pubchem(name)
    alts = [pc.get("pubchem_title")] if pc.get("pubchem_title") else []
    ot = opentargets(name, alts)
    src = "Open Targets (ChEMBL mechanisms)"
    if not ot["targets"] and USE_CHEMBL_FALLBACK:
        ch = chembl_fallback(name)
        if ch["targets"]:
            ot.update({k: ch[k] for k in ("targets", "uniprot", "mechanisms")})
            ot["chembl_id"] = ot["chembl_id"] or ch["chembl_id"]
            src = "ChEMBL web services"
    db = pc.get("drugbank") or ot.get("drugbank")
    db_src = "PubChem synonym list" if pc.get("drugbank") else ("Open Targets cross-reference" if ot.get("drugbank") else None)
    return {"name": name, "cid": pc["cid"], "smiles_pubchem": pc["smiles"], "pubchem_title": pc["pubchem_title"],
            "drugbank": db, "drugbank_source": db_src, "chembl_id": ot.get("chembl_id"), "chembl_pref_name": ot.get("ot_name"),
            "targets": ot["targets"], "uniprot": ot["uniprot"], "mechanisms": ot["mechanisms"],
            "target_source": src if ot["targets"] else None}
