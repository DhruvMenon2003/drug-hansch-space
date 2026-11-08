# pk_harvest — literature sources for the Therapeutic Index workbook

Fills `data/therapeutic_index/Therapeutic_Index_Table.xlsx` from
`data/therapeutic_index/Therapeutic_Index_Table_input.xlsx` (the uploaded workbook): two independent papers
per drug with verbatim pharmacokinetic quotes, database identifiers, and the row-5 summary formulas.

```bash
# 1. harvest (resumable; results land in cache/results/<n>.json, cache/ is gitignored)
uv run --with requests --with openpyxl python tools/pk_harvest/harvest.py \
    --xlsx data/therapeutic_index/Therapeutic_Index_Table_input.xlsx --start 1 --end 1373 --workers 8
# 2. review a slice
uv run python tools/pk_harvest/review.py 1 20 --full
# 3. write the workbook
uv run --with openpyxl --with rdkit python tools/pk_harvest/write_workbook.py \
    --input data/therapeutic_index/Therapeutic_Index_Table_input.xlsx \
    --output data/therapeutic_index/Therapeutic_Index_Table.xlsx
# 4. independent check of the Excel-365-only summary cells
uv run --with openpyxl python tools/pk_harvest/summary_check.py data/therapeutic_index/Therapeutic_Index_Table.xlsx
```

| Module | Role |
| --- | --- |
| `common.py` | cached, throttled HTTP (Europe PMC, PubChem, Open Targets, ChEMBL); 70 kg default body weight |
| `epmc.py` | Europe PMC query ladder (drug name required in the title), animal / in-vitro filters, population tags, abstract + open-access full-text capture into quotable blocks |
| `extract.py` | regex extraction of clearance, volume of distribution, protein binding / fu, bioavailability, dose regimen, therapeutic and toxic ranges; unit normalisation to the workbook units; sentence-stated body weight overrides the 70 kg default |
| `harvest.py` | per-drug orchestration, pair selection (different first authors, values within 1.5×), verbatim verification |
| `ids.py` | DrugBank ID, SMILES (PubChem), mechanism / target / UniProt (Open Targets, ChEMBL fallback off by default) |
| `write_workbook.py` | DOI columns, fill-empty-only cell policy, `PK Evidence` and `Harvest Log` sheets, summary formulas |
| `summary_check.py` | Python recomputation of B5/D5/F5/H5/K5 |

Access policy: public abstracts and open-access full text only. No paywalled text, no shadow-library copies.
Quotes are exact substrings of the captured text; the `PK Evidence` sheet records the verification status, the
locator (section / table row and opening words) and a public URL for every row.

Known limits: regex extraction misses values phrased unusually and cannot read paywalled full text; values from
paediatric, impaired-organ or interaction studies are tagged, not excluded; a filled PK cell takes the Source 1
value, with both sources' values in `PK Evidence`. `Harvest Log` lists every drug with no, one, or
non-agreeing sources.
