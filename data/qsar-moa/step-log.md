# Step log: QSAR mechanism-of-action dataset

All times are UTC on 2026-11-23. Each line is one step, what was used, and what came out.

| # | Time | Step | Input | Result |
|---|------|------|-------|--------|
| 1 | 22:58 | Received the task and the answers 1B, 2A, 3A, 4B, 5A, 6, 7B and "Option A". | Project chat | Work started in the thread "Build QSAR mechanism-of-action dataset". |
| 2 | 23:00 | Read the template spreadsheet: sheets, header row, all notes, formulas, fill counts. | `Drug-Leaderboard-v3-live-summary-fixed.xlsx` | 4 sheets. 1,373 drugs in rows 25 to 1397. 17 columns per drug. 10 notes. "Drug Target" filled for 496 drugs, 233 distinct names. 19 drugs have both therapeutic and toxic levels. No pictures. |
| 3 | 23:00 | Read the Data Provenance sheet. | Same file | 11,249 records with columns Row, Column, Drug, Original value, New value, Source, Source detail / quote, Rule, Flags. Mechanism names were sourced from ChEMBL. |
| 4 | 23:01 | Opened the Google Slides deck "9 November 2026 Internship Update". | Deck link in the project instructions | 19 slides. Slide 4 holds the title "Dataset Curation Workflow" and the Excalidraw room link only. |
| 5 | 23:01 | Read the Excalidraw worked example (apricitabine, written dOTC). | `Data Curation Workflow.excalidraw`, `Dataset Curation Workflow.png` | 27 boxes, 29 text items, 24 arrows, 13 cropped pictures, 8 references. Layout: structures, target, target type, activity and toxicity checks, in vitro, single dose pharmacokinetics in healthy volunteers, cropped tables and figures, minimum therapeutic level 400 mg, minimum toxic level 1600 mg. |
| 6 | 23:01 | Agreed a split with the thread the user started for helper agents: that thread reads the book chapter by chapter and writes one JSON file per chapter. | Message from that thread | Files expected in `qsar-moa/extraction/`, with `chapters.json` listing each chapter as "read" or "not read". |
| 7 | 23:02 | Reported the review in the thread and asked one question (unit for therapeutic and toxic levels). | Steps 2 to 5 | Waiting for the answer. Default while waiting: keep dose (mg) and concentration (mg/L) in separate columns. |
| 8 | 23:02 | Tested OpenAlex search. | Query `"Nucleoside Reverse Transcriptase Inhibitors" QSAR` | Service answered (HTTP 200). |
| 9 | 23:03 | Tested the DrugBank website. | `go.drugbank.com/drugs/DB00945` | Blocked for automated reading (HTTP 403, bot challenge). |
| 10 | 23:03 | Tested PubChem's copy of DrugBank's "Mechanism of Action" section. | PubChem compound 2244 (acetylsalicylic acid) | Works (HTTP 200). The text is credited to DrugBank and links to the DrugBank page. |
| 12 | 23:07 | User answered the unit question. | Decision card | "B. Dose in mg only": Minimum Therapeutic Level and Minimum Toxic Level in the new sheet are doses in mg, as in the worked example (400 mg and 1600 mg). |
| 11 | 23:03 | Built a one-row-per-drug lookup from the user's DrugBank export. | `drugbank_drugs_info.csv` (232 MB, 201,415 records) | `qsar-moa/drugbank_index.json` with 4,675 distinct DrugBank IDs (name, description, CAS number, InChIKey, SMILES). The export has no mechanism-of-action column. |
| 13 | 23:12 | Received the first chapter files from the reading thread: 9 chapters read, 9 stopped by the safety filter (1, 2, 3, 4, 7, 8, 9, 17, 18), 13 waiting for the usage limit (5, 11, 21 to 31). | `extraction/chapters.json`, `ch*.json` | 101 records. `ch11.json` and `ch17.json` are not valid JSON (unfinished) and were skipped. |
| 14 | 23:13 | Checked every quote against the book PDF by program and cropped a screenshot around it (200 dpi). | `records_verified.json`, `screenshots/` | 100 of 101 quotes found exactly on the helper's page; 1 not found (CP55940, p. 113). 76 distinct screenshot files. Looked at one crop (AM251, p. 120) to confirm the crop shows the quoted lines. |
| 15 | 23:13 | Applied your decision to ignore targets that are neither receptor nor enzyme, and dropped records with no stated direction. | `records_included.json`, `records_excluded.json` | 76 records kept (75 drug rows after merging duplicates), 25 left out with reasons. |
| 16 | 23:14 | Looked up each drug in the DrugBank export; set spelling aliases by hand for 11 names. | `drugbank_index.json`, `config.mjs` | 33 drugs matched; 11 names with no match in the export (the export only holds drugs in clinical trials). |
| 17 | 23:15 | Fetched DrugBank's "Mechanism of action" text through PubChem's credited copy, because go.drugbank.com blocks automated reading. | `drugbank_moa_text.json` | Text found for all 33 matched drugs. |
| 18 | 23:17 | Set a DrugBank verdict for each drug and mechanism by reading the text. | Workbook, "DrugBank check" column | 24 confirmed, 9 target confirmed with direction implied, 3 direction not stated, 8 not stated, 4 disagree (acamprosate, baclofen, topiramate on GABA A, riluzole). |
| 19 | 23:18 | Ran OpenAlex searches: 2 per mechanism, 10 papers each. | `openalex_papers.json`, `paper_list_openalex.csv` | 41 mechanisms, 82 searches, 820 rows (768 distinct works). 64 exact-phrase searches had 10 or more matches; 14 had 1 to 9 and 4 had none, so those lists were topped up without quotation marks (amber cells). |
| 20 | 23:19 | Built the workbook and read it back. | `Drug-Leaderboard-v5-mechanism-of-action.xlsx` | 8 sheets. 75 drug rows in 41 mechanism groups. All 75 screenshot links point to existing files. |

## 2026-11-24 (UTC)

| # | Time | Step | Input | Result |
|---|------|------|-------|--------|
| 21 | 00:05 | All 31 chapters read by the reading thread. | `extraction/ch01.json` to `ch31.json` | 436 records, all files parse. |
| 22 | 00:07 | Checked every quote against the book's text layer, no model calls. | `extraction/quote-location-check.json` | 415 of 436 match exactly after the reading thread restored 21 quotes to the printed wording. 21 sit inside figures or tables and cannot be matched as text. No record cites the wrong page. |
| 23 | 00:16 | User ruling: only the four action words, drop everything else, verify with DrugBank. | Project chat | Applied. |
| 24 | 04:19 | Reading thread re-read every record against its page, and compared every kept record with DrugBank. | `extraction/verify/surviving-records.json`, `consistency-pass.json`, `drugbank-comparison.json` | 270 kept, 166 dropped, 0 renamed. Recall sample: 50 of 50 found. I parse-checked the comparison file: 270 entries, no out-of-range record numbers, no duplicates. |
| 25 | 11:00 | Built rows: one per drug, grouped by mechanism. | `rows.json` | 221 rows, 111 mechanisms. 17 records dropped as neither receptor nor enzyme; 149 dropped as outside the four words. |
| 26 | 11:01 | Cropped one book screenshot per row. | `book-screenshots/` | 221 files: 208 cropped to the quoted lines, 13 whole pages where the text is inside a picture. |
| 27 | 11:02 | Conflict rule from the user: DrugBank's direction in the main column, book wording beside it, flagged. | `rows.json` | 2 rows carry a direction conflict. 7 rows where DrugBank names a different target are flagged as "not a contradiction". |
| 28 | 11:04 | Added sheet "Mechanism of Action" to the user's workbook by adding one worksheet part; no existing part rewritten. | `Drug-Leaderboard-v3-live-summary-fixed.xlsx` | 334 rows x 22 columns. All 4 existing sheets compared cell by cell with the backup: 128,390 cells, 0 differ. |
| 29 | 11:05 | Backup kept. | `qsar-moa/Drug-Leaderboard-v3-live-summary-fixed.BACKUP-before-mechanism-sheet.xlsx` | Byte-identical to the workbook before the change. |
| 30 | 11:16 | Ran the paper searches again from the complete mechanism list. | `paper-list-openalex-2026-11-24.csv` | 111 mechanisms, 222 searches, 2,193 rows. 0 empty searches, 5 short lists, 42 filled without quotation marks. |
| 31 | 11:25 | Paused for the user to upload papers. No extraction started. | | |
