# Plan: fill the Therapeutic Index workbook from verbatim literature sources

Date: 2026-11-07. Input: `Therapeutic_Index_Table_-_leaderboard_mechanism_added.xlsx` (user upload).
Output: `data/therapeutic_index/Therapeutic_Index_Table.xlsx` plus the pipeline in `tools/pk_harvest/`.

## Decisions confirmed with the user (2026-11-07)

| Question | Decision |
|---|---|
| Drug order | Strict `Drug Names` sheet order (A2 → A1374, 1,373 drugs), run in batches, commit per batch |
| Summary statistics | Rows with Log TI = 0 (no therapeutic/toxic level) are excluded everywhere; TI > 4 is tested as Log TI > LOG10(4) |
| Where sources live | Inside the workbook only: `Source 1 DOI` / `Source 2 DOI` table columns, a `PK Evidence` sheet (verbatim quotes + locators + public URLs), no PDF files stored |
| Columns to fill | PK columns and therapeutic/toxic levels from the two papers; DrugBank ID, SMILES, target, UniProt from databases (PubChem, ChEMBL, UniChem), RDKit-canonical SMILES |

Access policy (mine, stated to the user): no Anna's Archive, Sci-Hub or Z-Library. Text is captured only
from public abstracts (Europe PMC/PubMed), PMC open-access full text, publisher open-access full text and
Unpaywall-listed OA copies. Paywalled papers contribute their public abstract and DOI only.

## Existing values are kept

Lombardo-2018 values already in the table (Vss, CL, fu) are not overwritten. Papers fill empty cells and
corroborate filled ones; the evidence sheet records agreement with the existing value.

## Pipeline (`tools/pk_harvest/`)

1. `harvest.py` — for each drug: Europe PMC query ladder → candidate papers → capture text (abstract always;
   PMC full-text XML when open access) → regex extraction of PK sentences with units → normalise to workbook
   units → choose two independent papers (different first author, different DOI) whose values agree
   (max/min ≤ 1.5) → write `cache/results/<n>.json`.
2. `ids.py` — PubChem CID/SMILES/DrugBank synonym, UniChem DrugBank mapping, ChEMBL mechanism → target
   name + action + UniProt accession.
3. `write_workbook.py` — load the original workbook with openpyxl, add the two DOI columns (table + mirrored
   view side), fill empty PK/level/identifier cells, write the `PK Evidence` and `Harvest Log` sheets, write
   the row-5 summary formulas, recalculate with LibreOffice and report formula errors.

## Summary formulas (row 5, all structured references to `Therapeutic_Index`)

- B5 `% wide` = COUNTIFS(LogTI > LOG10(4)) / COUNTIF(LogTI > 0)
- D5 `% narrow` = COUNTIFS(LogTI > 0, LogTI < LOG10(4)) / COUNTIF(LogTI > 0)
- F5 `Top 5` = TEXTJOIN(CHAR(10), TAKE(SORTBY(FILTER(names, LogTI>0), FILTER(LogTI, LogTI>0), -1), 5))
- H5 `Bottom 5` = same, ascending Log TI, tie broken by In Vivo Free Drug Concentration (descending)
- K5 `Highest median TI category` = LET/MAP/LAMBDA over UNIQUE(Drug Target) medians of Log TI

These need Excel 365 (the file already uses XMATCH/SORT/UNIQUE). LibreOffice 24.2 in this container cannot
evaluate them, so they are checked by an independent Python computation, not by recalculation.

## Verification

- Every quote is an exact substring of the captured text; status `exact` / `exact (whitespace)` /
  `NOT IN SOURCE` is written per evidence row.
- LibreOffice recalculation for the non-365 formulas; Python re-computation for the 365-only ones.
- Spot-check 10 random evidence rows by opening the public URL.
