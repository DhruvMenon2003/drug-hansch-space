"""Mark explorer drugs that are not usable for QSAR (metal or other non-organic element after RDKit standardisation).

Adds "inorg": true to those rows of site/data/drugs.json; the explorer's "fits use drugs up to 1000 Da" filter then
also leaves them out (js/model.js passes()). Run after tools/build_data.py:  python3 tools/flag_inorganic.py
"""
import json
from pathlib import Path

from build_qsar_targets import standardize

PATH = Path(__file__).resolve().parent.parent / "site/data/drugs.json"
data = json.loads(PATH.read_text())
hit = []
for d in data["drugs"]:
    m, why = standardize(d.get("smiles") or "")
    d.pop("inorg", None)
    if why == "inorganic or metal":
        d["inorg"] = True
        hit.append(d["name"])
PATH.write_text(json.dumps(data, separators=(",", ":")))
print(len(hit), "flagged:", ", ".join(hit))
