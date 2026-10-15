"""Target artwork for the binding overlay: one RCSB PDB structure image per drug's mechanism-of-action target.

drug (ChEMBL id) -> ChEMBL mechanism -> target -> UniProt accession -> PDBe best structure -> RCSB assembly image.
RCSB PDB structure images are free to use with attribution (https://www.rcsb.org/pages/policies); the overlay names
the PDB ID and links the entry. Images are resized to small WebP files in site/art/; the map is site/data/art.json.

    python3 tools/build_art.py            # uses a cache under tools/.cache/art so a re-run costs no requests
"""
import io, json, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen, Request

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SITE, CACHE = ROOT / "site", ROOT / "tools" / ".cache" / "art"
MECH = "https://www.ebi.ac.uk/chembl/api/data/mechanism.json?molecule_chembl_id={}&limit=20"
TARGET = "https://www.ebi.ac.uk/chembl/api/data/target/{}.json"
SIFTS = "https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/{}"
IMG = "https://cdn.rcsb.org/images/structures/{}_assembly-1.jpeg"


def get(url, binary=False, tries=3):
    key = CACHE / (url.split("://", 1)[1].replace("/", "_").replace("?", "_").replace("&", "_")[:180])
    if key.exists():
        b = key.read_bytes()
        return b if binary else (json.loads(b) if b else None)
    for k in range(tries):
        try:
            with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": "drug-hansch-space/1"}), timeout=30) as r:
                b = r.read()
            break
        except Exception as e:
            if getattr(e, "code", None) == 404:
                b = b""
                break
            time.sleep(2 ** k)
    else:
        return None
    key.write_bytes(b)
    return b if binary else (json.loads(b) if b else None)


def for_drug(d):
    mech = (get(MECH.format(d["chembl"])) or {}).get("mechanisms") or []
    for m in mech:
        tid = m.get("target_chembl_id")
        if not tid:
            continue
        t = get(TARGET.format(tid)) or {}
        accs = [c["accession"] for c in t.get("target_components") or [] if c.get("accession")]
        for acc in accs:
            best = (get(SIFTS.format(acc)) or {}).get(acc) or []
            if best:
                return {"pdb": best[0]["pdb_id"].lower(), "target": t.get("pref_name"), "moa": m.get("mechanism_of_action"), "uniprot": acc}
    return None


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    (SITE / "art").mkdir(exist_ok=True)
    drugs = [d for d in json.loads((SITE / "data" / "drugs.json").read_text())["drugs"] if d.get("chembl")]
    with ThreadPoolExecutor(8) as ex:
        got = list(ex.map(for_drug, drugs))
    # the 20 annotated scenes show their own co-crystal, so their images are fetched as well
    pdbs = {sc["pdb"].lower() for sc in json.loads((SITE / "data" / "binding" / "index.json").read_text())["scenes"]}
    out = {}
    for d, a in zip(drugs, got):
        if a:
            out[str(d["cid"])] = a
            pdbs.add(a["pdb"])

    def image(pid):
        b = get(IMG.format(pid), binary=True)
        if not b:
            return pid, False
        im = Image.open(io.BytesIO(b)).convert("RGB")
        im.thumbnail((240, 240))
        im.save(SITE / "art" / f"{pid}.webp", "WEBP", quality=62, method=6)
        return pid, True

    with ThreadPoolExecutor(8) as ex:
        ok = dict(ex.map(image, sorted(pdbs)))
    out = {k: v for k, v in out.items() if ok.get(v["pdb"])}
    have = sorted(p for p, y in ok.items() if y)
    meta = {"source": "RCSB PDB structure images (rcsb.org), target from ChEMBL mechanism, structure from PDBe best_structures",
            "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (SITE / "data" / "art.json").write_text(json.dumps({"meta": meta, "pdbs": have, "drugs": out}, separators=(",", ":")))
    print(f"{len(out)} of {len(drugs)} drugs have target art; {sum(ok.values())} images", file=sys.stderr)


if __name__ == "__main__":
    main()
