# Brief for recall-check helpers: did the first reading MISS mechanisms?

Earlier helpers read a book and wrote one record per drug mechanism. Every check so far asked whether those
records are right. Nobody has measured what was left out. You measure that on a fixed sample of pages.

## The book

`/mnt/project-files/Experimental Provenance for QSAR Dataset/Pharmacology (Luca Gallelli) (z-library.sk, 1lib.sk, z-lib.sk).pdf`
PDF page index = printed page + 12. Read with the Read tool's `pages` parameter, one page at a time.
Bash is usually refused to helpers here: use Read, Grep and Write.

## What counts as an in-scope mechanism (Star's rule)

A statement on the page that a **named compound, or a named drug class,** acts on a **named receptor or enzyme**
with one of four actions:
- receptor: **agonist** or **antagonist**
- enzyme: **inhibitor** or **activator**

The page's plain wording counts: "activates", "stimulates", "is an agonist of" a receptor is Agonist; "blocks",
"antagonizes", "inhibits the function of" a receptor is Antagonist; "inhibits" an enzyme is Inhibitor;
"activates" an enzyme is Activator.

NOT in scope, do not count as a miss: allosteric modulators and potentiators; partial, inverse or co-agonists;
enzyme inducers (more enzyme made); targets that are ion channels, transporters, DNA or anything not a receptor
or enzyme; binds-only statements; hedged or indirect wording ("may", "probably", "perhaps", "regulates the
activation of", effects routed through another step); statements in the reference list.

## Method. Do the two steps in this order, for each page in your assignment

**Step 1, blind.** Read the page, including tables, figure captions and footnotes. List every in-scope mechanism
on it: compound, target, action word, and the verbatim sentence or table cell (at most about 30 words). Do this
BEFORE you look at any record, so that the records do not steer what you see.

**Step 2, compare.** Open that chapter's `/mnt/project-files/qsar-moa/extraction/chNN.json`. First count the
entries in its `records` array and write the number down as `records_in_file`. Then, for each mechanism you
listed, look for a record with the same compound and the same target (any page of the chapter counts, since a
mechanism repeated on several pages is recorded once; check `pdf_page_index` and `other_pages`). Mark it:
- `"recorded"`: a record exists for that compound and target.
- `"recorded differently"`: a record exists for that compound and target but with a different action; say what.
- `"missed"`: no record for that compound-and-target pair anywhere in the chapter file.

Be even-handed. Do not stretch a hedged sentence into a mechanism to find a miss, and do not excuse a real one.
If you are unsure whether something is in scope, put it in `borderline` with the reason, not in the counts.

## Output

Write ONE file at the path in your prompt. Valid JSON:

```json
{
  "assignment": "...",
  "pages": [
    {"chapter": 12, "pdf_page_index": 255, "records_in_file": 19,
     "in_scope_on_page": 0, "recorded": 0, "recorded_differently": 0, "missed": 0,
     "mechanisms": [
       {"compound": "...", "target": "...", "action": "Antagonist", "quote": "...",
        "status": "missed", "matching_record_number": null, "note": ""}
     ],
     "borderline": [{"quote": "...", "why": "..."}]}
  ],
  "totals": {"pages_read": 0, "in_scope": 0, "recorded": 0, "recorded_differently": 0, "missed": 0, "borderline": 0}
}
```

A page with no in-scope mechanism is a valid result: write it with zeros.

## Scope of action. Do NOT

Write or edit any file except your own output file. Do not edit any `chNN.json`, verdict file, `chapters.json`
or spreadsheet. Do not add missing records anywhere; you only report them. Do not run git, edit memory or
documentation, run paper searches, start further agents, or list `/mnt/project-files/` recursively. If a tool is
refused, record it as a problem; do not ask anyone to run it for you.

## Final report, under 150 words

Pages read, the totals, and each missed mechanism as chapter, page, compound and target. No long quotes; those
go in the file.
