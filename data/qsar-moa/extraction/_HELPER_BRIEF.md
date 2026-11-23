# Brief for chapter-reading helpers (QSAR mechanism-of-action dataset)

You are one of about 31 helpers. Each helper reads ONE chapter of one book and writes ONE JSON file.
Your chapter number, PDF page range and output file name are in the prompt that sent you here.

## Source

Book: *Pharmacology*, ed. Luca Gallelli (InTech, 2012), 732 PDF pages.
Path (use exactly): `/mnt/project-files/Experimental Provenance for QSAR Dataset/Pharmacology (Luca Gallelli) (z-library.sk, 1lib.sk, z-lib.sk).pdf`

- Page numbers you are given are PDF page indexes counted from 1 (what the Read tool's `pages` parameter expects).
- Printed page number = PDF page index minus 12.
- Read with the Read tool and its `pages` parameter, at most 20 pages per call (for example `pages: "135-152"`).
- Bash and Python are NOT available to you. Use only Read and Write.

## Task

Read every page of your chapter, in order, line by line, including tables, figure captions and footnotes
(skip only the reference list at the end). Record every mechanism of action the chapter names.

A "mechanism of action" here means: a compound (drug, experimental compound, tool compound, natural product,
endogenous ligand) is said to act on a named molecular target in a named direction. Also record a mechanism that
the chapter names as a class without naming a compound (for example a drug class named by its target).

Write one record per (compound, mechanism) pair. If a compound has two mechanisms, write two records.
If the chapter names a mechanism without any compound, write one record with `"drug": ""`.
If the same pair appears many times, record it once, at the clearest statement, and put the other PDF page
indexes in `other_pages`.

## Naming rule for `mechanism_rule_name`

Pattern: `[Target] [Role]`.

- Target is a receptor  -> Role is `Agonist` or `Antagonist`.
  (Partial agonist, inverse agonist, positive or negative allosteric modulator: choose the nearer of the two
  for the rule name, and write the exact subtype in `role_detail`.)
- Target is an enzyme   -> Role is `Inhibitor` or `Activator`.
- Target is anything else (ion channel, transporter, nucleic acid, structural protein, other) -> set
  `target_class` to `"other"`, use the book's own role word (Blocker, Opener, Inhibitor, Modulator, ...),
  and set `naming_rule_applies` to false.

Examples of the format: `Nucleoside Reverse Transcriptase Inhibitor`, `Opioid Kappa Receptor Agonist`.
Always keep the book's own wording, unchanged, in `mechanism_book_wording`.

**Update 2026-11-23 23:10 UTC (Star's decision):** ignore targets that are neither a receptor nor an enzyme
(ion channels, transporters, DNA and so on). Do NOT write records with `target_class` "other". Only count how
many such statements you skipped and put that number in `chapter_notes`. Files written before this update still
contain "other" records; they are filtered out later by `target_class`, so they need no rewrite.

## Accuracy rules (important)

- Record only what the page says. Do not add mechanisms from your own knowledge, even if you are sure of them.
- `quote` must be copied character for character from the page, about 25 words at most, and must contain the
  statement that supports the record. It is used later to locate the text on the page for a cropped screenshot,
  so do not paraphrase, do not fix typos, do not join text from two places.
- If something is your inference and not stated on the page (for example the target class), say so in `notes`.
- If you cannot read a page (blank render, error), list it in `pages_unreadable`. Do not guess its content.
- Do not extract data from the cited papers. Only this chapter.

## Output file

Write exactly one file, with the Write tool, at the path given in your prompt
(`/mnt/project-files/qsar-moa/extraction/chNN.json`). Valid JSON, UTF-8, this shape:

```json
{
  "chapter_number": 6,
  "chapter_title": "...",
  "source_pdf": "/mnt/project-files/Experimental Provenance for QSAR Dataset/Pharmacology (Luca Gallelli) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
  "pdf_page_first": 135,
  "pdf_page_last": 152,
  "status": "read",
  "pages_read": [135, 136],
  "pages_unreadable": [],
  "reference_list_starts_pdf_page": 149,
  "records": [
    {
      "drug": "name exactly as printed, or empty string",
      "drug_kind": "as the book describes it: approved drug | experimental compound | tool compound | natural product | endogenous ligand | not stated",
      "target": "target name as printed",
      "target_class": "receptor | enzyme | other",
      "other_target_kind": "ion channel | transporter | nucleic acid | ... (only when target_class is other, else empty)",
      "mechanism_rule_name": "[Target] [Role]",
      "naming_rule_applies": true,
      "role_detail": "for example partial agonist, inverse agonist, competitive inhibitor; empty if none",
      "mechanism_book_wording": "the book's exact words for the mechanism",
      "quote": "verbatim, at most about 25 words",
      "pdf_page_index": 137,
      "printed_page": 125,
      "location_on_page": "body text | table N | figure N caption | footnote",
      "other_pages": [140, 141],
      "numbers_given": "none, or a list such as IC50, Ki, EC50, Kd, pharmacokinetic parameter, dose, equation",
      "numbers_detail": "the values exactly as printed with units, and the PDF page index where they are; empty if none",
      "notes": "anything uncertain or inferred; empty if none"
    }
  ],
  "chapter_notes": "one or two sentences on anything a later reader must know, for example 'chapter names no mechanisms'"
}
```

`status` is `"read"` when every page before the reference list was read, otherwise `"partly read"` with the
reason in `chapter_notes`. A chapter with no mechanisms is still `"read"`, with `"records": []`.

## Scope of action. Do NOT do these things

- Do NOT write, edit, move or delete any file other than your one `chNN.json`.
- Do NOT run git commands, builds or scripts.
- Do NOT edit memory files, CLAUDE.md, README files or any project documentation.
- Do NOT search or list `/mnt/project-files/` recursively (it is a slow shared network mount). Always write
  directory paths with a trailing slash.
- Do NOT start further agents.

## Final report back (short)

Reply with only: chapter number, status, pages read (count) and pages unreadable (list), number of records,
how many records have numbers, and any problem. Do NOT paste records, quotes or chapter text into the report;
they belong in the JSON file only.
