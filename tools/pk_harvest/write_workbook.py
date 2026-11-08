#!/usr/bin/env python3
"""Write harvest results into the Therapeutic Index workbook.

    uv run --with openpyxl --with rdkit python tools/pk_harvest/write_workbook.py \
        --input data/therapeutic_index/Therapeutic_Index_Table_input.xlsx \
        --output data/therapeutic_index/Therapeutic_Index_Table.xlsx

What it changes in the user's workbook (everything else is left exactly as uploaded):
* row 5 summary cells B5, D5, F5, H5, K5 get formulas (Excel 365 dynamic-array functions, as the table already uses);
  the placeholder data validation on K4 is removed;
* two new table columns `Source 1 DOI` / `Source 2 DOI` (AO:AP) plus mirrored HYPERLINK columns R:S on the view side;
* empty cells only are filled: identifiers (AA, AB, AC, AD), levels (AE, AF — only when both come with one unit),
  PK (AH, AI, AJ, AK, AL, AM). Existing numbers are never overwritten; 'N.F.' counts as empty;
* new sheets `PK Evidence` (one row per drug × source × parameter, verbatim quote + locator + URL) and `Harvest Log`.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import time
from pathlib import Path

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.worksheet.table import TableColumn

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import RESULTS  # noqa: E402

FIRST_ROW, LAST_ROW = 25, 1397
COL = {"name": "Z", "drugbank": "AA", "smiles": "AB", "target": "AC", "uniprot": "AD", "ther": "AE", "tox": "AF",
       "logti": "AG", "vss": "AH", "cl": "AI", "dose": "AJ", "interval": "AK", "fabs": "AL", "fu": "AM", "conc": "AN",
       "doi1": "AO", "doi2": "AP"}
PARAM_COL = {"Vss": "vss", "CL": "cl", "dose_ug": "dose", "interval_min": "interval", "F": "fabs", "fu": "fu"}
PARAM_LABEL = {"CL": "Clearance", "Vss": "Steady State Volume of Distribution", "fu": "Fraction unbound",
               "F": "Fraction absorbed (bioavailability)", "dose_ug": "Dosage", "interval_min": "Dose Interval",
               "ther_min": "Minimum Therapeutic Level", "ther_max": "Upper therapeutic level (not a table column)",
               "tox_min": "Minimum Toxic Level"}
UNIT_FAMILY = {"mg/l": "mg/L", "µg/ml": "mg/L", "μg/ml": "mg/L", "ug/ml": "mg/L", "mcg/ml": "mg/L",
               "ng/ml": "µg/L", "µg/l": "µg/L", "μg/l": "µg/L", "ug/l": "µg/L", "mcg/l": "µg/L",
               "mmol/l": "mmol/L", "meq/l": "mEq/L", "nmol/l": "nmol/L", "µmol/l": "µmol/L", "μmol/l": "µmol/L", "umol/l": "µmol/L",
               "ng/l": "ng/L", "pg/ml": "ng/L", "iu/ml": "IU/mL", "u/ml": "U/mL"}

T = "Therapeutic_Index"
LOGTI = f"{T}[Log Therapeutic Index]"
F_WIDE = f'=IFERROR(COUNTIFS({LOGTI},">"&LOG10(4))/COUNTIF({LOGTI},">0"),0)'
F_NARROW = f'=IFERROR(COUNTIFS({LOGTI},">0",{LOGTI},"<"&LOG10(4))/COUNTIF({LOGTI},">0"),0)'
F_TOP5 = (f'=_xlfn.LET(_xlpm.ok,{LOGTI}>0,_xlpm.n,_xlfn._xlws.FILTER({T}[Drug Name],_xlpm.ok),'
          f'_xlpm.t,_xlfn._xlws.FILTER({LOGTI},_xlpm.ok),'
          f'_xlfn.TEXTJOIN(CHAR(10),TRUE,_xlfn.TAKE(_xlfn.SORTBY(_xlpm.n,_xlpm.t,-1),5)))')
F_BOTTOM5 = (f'=_xlfn.LET(_xlpm.ok,{LOGTI}>0,_xlpm.n,_xlfn._xlws.FILTER({T}[Drug Name],_xlpm.ok),'
             f'_xlpm.t,_xlfn._xlws.FILTER({LOGTI},_xlpm.ok),'
             f'_xlpm.c,_xlfn._xlws.FILTER({T}[In Vivo Free Drug Concentration],_xlpm.ok),'
             f'_xlfn.TEXTJOIN(CHAR(10),TRUE,_xlfn.TAKE(_xlfn.SORTBY(_xlpm.n,_xlpm.t,1,_xlpm.c,-1),5)))')
F_CATEGORY = (f'=_xlfn.LET(_xlpm.ok,({LOGTI}>0)*({T}[Drug Target]<>""),'
              f'_xlpm.g,_xlfn._xlws.FILTER({T}[Drug Target],_xlpm.ok),'
              f'_xlpm.t,_xlfn._xlws.FILTER({LOGTI},_xlpm.ok),'
              f'_xlpm.u,_xlfn.UNIQUE(_xlpm.g),'
              f'_xlpm.m,_xlfn.MAP(_xlpm.u,_xlfn.LAMBDA(_xlpm.x,MEDIAN(_xlfn._xlws.FILTER(_xlpm.t,_xlpm.g=_xlpm.x)))),'
              f'INDEX(_xlpm.u,_xlfn.XMATCH(MAX(_xlpm.m),_xlpm.m))&" (median log TI "&TEXT(MAX(_xlpm.m),"0.00")&")")')


def is_empty(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() in ("", "N.F.", "NF", "n.f.", "-"))


def copy_style(src, dst):
    dst.font = copy.copy(src.font)
    dst.fill = copy.copy(src.fill)
    dst.border = copy.copy(src.border)
    dst.alignment = copy.copy(src.alignment)
    dst.number_format = src.number_format


def canonical_smiles(smi: str | None) -> tuple[str | None, str]:
    if not smi:
        return None, ""
    try:
        from rdkit import Chem, RDLogger
        RDLogger.DisableLog("rdApp.*")
        m = Chem.MolFromSmiles(smi)
        if m is None:
            return smi, "PubChem SMILES (RDKit could not parse; not canonicalised)"
        return Chem.MolToSmiles(m), "PubChem SMILES canonicalised with RDKit MolToSmiles"
    except ImportError:
        return smi, "PubChem SMILES (RDKit unavailable at write time)"


def load_results() -> dict[int, dict]:
    out = {}
    for p in sorted(RESULTS.glob("*.json")):
        d = json.loads(p.read_text("utf-8"))
        out[d["index"]] = d
    return out


def cite(rec: dict) -> str:
    return f"{rec.get('first_author') or '?'} et al. {rec.get('year') or ''}, {rec.get('journal') or ''}".strip(", ")


def level_pair(sources: list[dict]) -> tuple[float, float, str, dict, dict] | None:
    """Therapeutic and toxic level in one unit family, from the two sources (either may provide either)."""
    thers, toxs = [], []
    for si, s in enumerate(sources, 1):
        for key, lst in (("ther_min", thers), ("tox_min", toxs)):
            h = s["params"].get(key)
            if h:
                fam = UNIT_FAMILY.get(h["unit"].lower())
                if fam:
                    lst.append((fam, h, si))
    for fam_t, ht, si_t in thers:
        for fam_x, hx, si_x in toxs:
            if fam_t == fam_x and hx["value"] > ht["value"]:
                return ht["value"], hx["value"], fam_t, ht, hx
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    wb = openpyxl.load_workbook(args.input)
    ws = wb["Drug Leaderboard"]
    names_ws = wb["Drug Names"]
    results = load_results()
    stamp = time.strftime("%Y-%m-%d", time.gmtime())

    # ---- 1. table: two DOI columns ----------------------------------------------------------------------
    tbl = ws.tables[T]
    tbl.ref = f"X24:{COL['doi2']}{LAST_ROW}"
    tbl.autoFilter.ref = tbl.ref
    next_id = max(c.id for c in tbl.tableColumns) + 1
    for i, (col, title) in enumerate(((COL["doi1"], "Source 1 DOI"), (COL["doi2"], "Source 2 DOI"))):
        tbl.tableColumns.append(TableColumn(id=next_id + i, name=title))
        ws[f"{col}24"] = title
        copy_style(ws[f"{COL['conc']}24"], ws[f"{col}24"])
        ws.column_dimensions[col].width = 30
    # mirrored view side R:S
    for col, src, title in (("R", COL["doi1"], "Source 1 DOI"), ("S", COL["doi2"], "Source 2 DOI")):
        ws[f"{col}24"] = title
        copy_style(ws["Q24"], ws[f"{col}24"])
        ws.column_dimensions[col].width = 30
        for r in range(FIRST_ROW, LAST_ROW + 1):
            ws[f"{col}{r}"] = f'=IF({src}{r}="","",HYPERLINK("https://doi.org/"&{src}{r},{src}{r}))'
            copy_style(ws[f"Q{r}"], ws[f"{col}{r}"])
            ws[f"{col}{r}"].font = Font(name=ws[f"Q{r}"].font.name, size=ws[f"Q{r}"].font.sz, color="0563C1", underline="single")
    ws[f"{COL['doi1']}24"].comment = Comment("DOI of the first literature source. Verbatim quotes, locators and public URLs for every value are in the 'PK Evidence' sheet; per-drug search status is in 'Harvest Log'.", "pk_harvest")

    # ---- 2. fill rows -----------------------------------------------------------------------------------
    evidence_rows, log_rows = [], []
    filled_counts: dict[str, int] = {}
    for i in range(1, LAST_ROW - FIRST_ROW + 2):
        r = FIRST_ROW + i - 1
        drug_cell = ws[f"{COL['name']}{r}"].value
        listed = names_ws[f"A{i + 1}"].value
        res = results.get(i)
        filled = []
        notes = []
        if listed and drug_cell and str(listed).strip() != str(drug_cell).strip():
            notes.append(f"Drug Names A{i + 1} ({listed!r}) differs from table Z{r} ({drug_cell!r}); row left unchanged")
            log_rows.append([i, r, drug_cell, "name mismatch", "", "", "", "", "", "", "", "", "; ".join(notes)])
            continue
        if not res:
            log_rows.append([i, r, drug_cell, "not yet harvested", "", "", "", "", "", "", "", "", ""])
            continue
        ids = res.get("ids") or {}
        srcs = res.get("sources") or []

        def put(key: str, value, note: str = ""):
            cell = ws[f"{COL[key]}{r}"]
            if is_empty(cell.value) and value not in (None, ""):
                cell.value = value
                filled.append(COL[key])
                filled_counts[key] = filled_counts.get(key, 0) + 1
                if note:
                    notes.append(f"{COL[key]}: {note}")

        # identifiers (databases)
        if ids.get("drugbank"):
            put("drugbank", ids["drugbank"], f"DrugBank ID via {ids.get('drugbank_source')}")
        smi, smi_note = canonical_smiles(ids.get("smiles_pubchem"))
        if smi:
            put("smiles", smi, f"{smi_note}; PubChem CID {ids.get('cid')}")
        if ids.get("targets"):
            put("target", "; ".join(ids["targets"]), f"mechanism/target via {ids.get('target_source')} ({ids.get('chembl_id')})")
        if ids.get("uniprot"):
            put("uniprot", "; ".join(ids["uniprot"]), f"UniProt Swiss-Prot accessions of the target components via {ids.get('target_source')}")

        # levels: only as a consistent pair
        lp = level_pair(srcs)
        if lp and is_empty(ws[f"{COL['ther']}{r}"].value) or (lp and ws[f"{COL['ther']}{r}"].value == 0 and ws[f"{COL['tox']}{r}"].value == 0):
            ther, tox, fam, ht, hx = lp
            ws[f"{COL['ther']}{r}"].value = ther
            ws[f"{COL['tox']}{r}"].value = tox
            filled += [COL["ther"], COL["tox"]]
            filled_counts["levels"] = filled_counts.get("levels", 0) + 1
            notes.append(f"AE/AF: therapeutic {ther} and toxic {tox} {fam} from the literature sources (see PK Evidence)")

        # PK parameters: source 1 value when both agree, else source 1 (flagged) — never overwrite
        agreed = set(res.get("agreed") or [])
        for param, key in PARAM_COL.items():
            h1 = srcs[0]["params"].get(param) if srcs else None
            h2 = srcs[1]["params"].get(param) if len(srcs) > 1 else None
            h = h1 or h2
            if not h:
                continue
            flag = "corroborated by both sources" if param in agreed else ("single source" if not (h1 and h2) else "sources differ (>1.5×); source 1 value used")
            put(key, h["value"], f"{PARAM_LABEL[param]} {h['value']} {h['unit']} — {flag}")

        # DOIs
        if srcs:
            put("doi1", srcs[0]["rec"].get("doi") or (f"PMID:{srcs[0]['rec'].get('pmid')}" if srcs[0]["rec"].get("pmid") else None))
        if len(srcs) > 1:
            put("doi2", srcs[1]["rec"].get("doi") or (f"PMID:{srcs[1]['rec'].get('pmid')}" if srcs[1]["rec"].get("pmid") else None))

        # evidence rows
        existing = {"CL": ws[f"{COL['cl']}{r}"].value, "Vss": ws[f"{COL['vss']}{r}"].value, "fu": ws[f"{COL['fu']}{r}"].value}
        for si, s in enumerate(srcs, 1):
            rec = s["rec"]
            other = srcs[1 - (si - 1)] if len(srcs) > 1 else None
            for param, h in s["params"].items():
                ov = other["params"].get(param)["value"] if other and other["params"].get(param) else None
                if ov is not None:
                    agr = "agree (≤1.5×)" if param in agreed else "differ (>1.5×)"
                else:
                    agr = "only this source"
                ex = existing.get(param)
                if isinstance(ex, (int, float)) and ex > 0 and h["value"] > 0:
                    ratio = max(ex, h["value"]) / min(ex, h["value"])
                    ex_flag = f"existing {ex}: {'within 1.5×' if ratio <= 1.5 else f'{ratio:.1f}× apart'}"
                else:
                    ex_flag = "no existing value" if param in existing else ""
                evidence_rows.append([
                    i, r, drug_cell, PARAM_LABEL.get(param, param), h["reported"], h["reported_unit"], h["value"], h["unit"],
                    h["normalisation"], h["subtype"], si, rec.get("doi") or "", rec.get("pmid") or "", rec.get("pmcid") or "",
                    rec.get("first_author") or "", rec.get("journal") or "", rec.get("year") or "", rec.get("title") or "",
                    ", ".join(rec.get("population") or []) or "general / unspecified", s.get("access", ""), h["locator"],
                    h["sentence"], s.get("url", ""), h["verified"], agr, ex_flag, stamp,
                ])
        log_rows.append([
            i, r, drug_cell, res.get("status"), ", ".join(res.get("agreed") or []), ", ".join(res.get("differ") or []),
            res.get("log", {}).get("candidates"), res.get("log", {}).get("dropped_animal"), res.get("log", {}).get("fulltext"),
            cite(srcs[0]["rec"]) if srcs else "", cite(srcs[1]["rec"]) if len(srcs) > 1 else "", ", ".join(filled), "; ".join(notes),
        ])

    # ---- 3. summary formulas --------------------------------------------------------------------------------
    ws["B5"] = F_WIDE
    ws["D5"] = F_NARROW
    ws["F5"] = ArrayFormula("F5", F_TOP5)
    ws["H5"] = ArrayFormula("H5", F_BOTTOM5)
    ws["K5"] = ArrayFormula("K5", F_CATEGORY)
    for c in ("B5", "D5"):
        ws[c].number_format = "0.0%"
    for c in ("F5", "H5", "K5"):
        ws[c].number_format = "General"
        ws[c].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[5].height = 80
    ws["B5"].comment = Comment("Share of drugs with therapeutic index > 4, i.e. Log Therapeutic Index > LOG10(4). Rows with no therapeutic/toxic level (Log TI = 0) are excluded from numerator and denominator.", "pk_harvest")
    ws["D5"].comment = Comment("Share of drugs with 0 < Log Therapeutic Index < LOG10(4) among drugs that have a Log TI > 0. A drug with TI exactly 4 is in neither group.", "pk_harvest")
    ws["F5"].comment = Comment("Five highest Log Therapeutic Index values among drugs with Log TI > 0, one name per line.", "pk_harvest")
    ws["H5"].comment = Comment("Five lowest Log Therapeutic Index values among drugs with Log TI > 0; ties broken by In Vivo Free Drug Concentration, higher concentration ranked worse (listed first).", "pk_harvest")
    ws["K5"].comment = Comment("Drug Target category with the highest median Log Therapeutic Index, computed over drugs with Log TI > 0 and a non-blank Drug Target. The median is appended in brackets.", "pk_harvest")
    # the placeholder dropdown (Central/East/West) on K4 is removed
    if ws.data_validations and ws.data_validations.dataValidation:
        ws.data_validations.dataValidation = [dv for dv in ws.data_validations.dataValidation if "K4" not in str(dv.sqref)]

    # ---- 4. evidence sheet ----------------------------------------------------------------------------------
    ev = wb.create_sheet("PK Evidence")
    ev_hdr = ["Drug #", "Table row", "Drug", "Parameter", "Reported value (verbatim)", "Reported unit", "Normalised value",
              "Workbook unit", "Normalisation", "Sub-type", "Source #", "DOI", "PMID", "PMCID", "First author", "Journal", "Year",
              "Title", "Study population tags", "Text captured from", "Locator", "Exact quote", "Public URL", "Quote verified",
              "Agreement between the two sources", "Comparison with existing table value", "Access date (UTC)"]
    ev.append(ev_hdr)
    for row in evidence_rows:
        ev.append(row)
    hdr_font = Font(name="Calibri", bold=True, color="FFFFFF")
    hdr_fill = PatternFill("solid", start_color="305496")
    for c in ev[1]:
        c.font, c.fill = hdr_font, hdr_fill
        c.alignment = Alignment(vertical="center", wrap_text=True)
    widths = [7, 8, 22, 26, 22, 12, 12, 11, 30, 18, 8, 28, 10, 12, 14, 24, 6, 50, 22, 26, 44, 90, 40, 14, 22, 24, 12]
    for idx, w in enumerate(widths, 1):
        ev.column_dimensions[get_column_letter(idx)].width = w
    for row in ev.iter_rows(min_row=2):
        row[21].alignment = Alignment(wrap_text=True, vertical="top")
        row[20].alignment = Alignment(wrap_text=True, vertical="top")
        row[17].alignment = Alignment(wrap_text=True, vertical="top")
    ev.freeze_panes = "D2"
    ev.auto_filter.ref = f"A1:{get_column_letter(len(ev_hdr))}{max(2, ev.max_row)}"

    # ---- 5. harvest log ---------------------------------------------------------------------------------------
    lg = wb.create_sheet("Harvest Log")
    intro = [
        "Harvest Log — how the Source 1 / Source 2 DOIs and the filled cells were obtained",
        f"Run date (UTC): {stamp}. Pipeline: tools/pk_harvest in the drug-hansch-space repository (harvest.py, extract.py, ids.py, write_workbook.py).",
        "Search: Europe PMC REST, five queries per drug ('clinical pharmacokinetics' / pharmacokinetic* in title, PK terms in abstract), drug name required in the title; animal, veterinary and in-vitro records dropped.",
        "Text captured: the public abstract of every candidate and the open-access full text (Europe PMC XML) where available. No paywalled full text, no shadow-library copies.",
        "Extraction: regular expressions for clearance, volume of distribution, protein binding / fraction unbound, bioavailability, dose regimen and therapeutic/toxic ranges; units converted to the workbook units (mL/min/kg, L/kg, µg, min, fractions). Where a conversion needs body weight, 70 kg is assumed and stated in 'Normalisation'.",
        "Selection: the two papers must have different first authors; the pair that agrees on the most parameters (max/min ≤ 1.5) wins, general adult studies preferred over paediatric / impaired / critically-ill populations.",
        "Writing: only empty cells are filled ('N.F.' counts as empty). Existing Lombardo-2018 values are kept; the 'PK Evidence' sheet states whether each literature value is within 1.5× of the existing one. For a filled PK cell the Source 1 value is used; both sources' values and quotes are in 'PK Evidence'.",
        "Identifiers: DrugBank ID from the PubChem synonym list or the Open Targets cross-reference; SMILES from PubChem, canonicalised with RDKit; target/mechanism and UniProt accessions from Open Targets (ChEMBL mechanisms), ChEMBL web services as fallback.",
        "Every quote is an exact substring of the captured text ('Quote verified' column). Values with status '1 source only', 'values differ' or 'no overlapping parameter' are not corroborated and should be read as provisional.",
    ]
    for line in intro:
        lg.append([line])
    lg["A1"].font = Font(bold=True, size=13)
    lg.append([])
    lg_hdr = ["Drug #", "Table row", "Drug", "Status", "Parameters agreeing", "Parameters differing", "Candidate papers",
              "Animal/in-vitro dropped", "Full texts read", "Source 1", "Source 2", "Cells filled", "Notes"]
    lg.append(lg_hdr)
    hdr_row = lg.max_row
    for c in lg[hdr_row]:
        c.font, c.fill = hdr_font, hdr_fill
    for row in log_rows:
        lg.append(row)
    for idx, w in enumerate([7, 8, 26, 34, 22, 20, 10, 10, 9, 40, 40, 30, 90], 1):
        lg.column_dimensions[get_column_letter(idx)].width = w
    lg.freeze_panes = f"D{hdr_row + 1}"
    lg.auto_filter.ref = f"A{hdr_row}:{get_column_letter(len(lg_hdr))}{lg.max_row}"

    wb.save(args.output)
    n_two = sum(1 for d in results.values() if len(d.get("sources") or []) == 2)
    n_agree = sum(1 for d in results.values() if d.get("agreed"))
    print(json.dumps({"drugs_harvested": len(results), "two_sources": n_two, "two_sources_agreeing": n_agree,
                      "evidence_rows": len(evidence_rows), "cells_filled": filled_counts, "output": args.output}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
