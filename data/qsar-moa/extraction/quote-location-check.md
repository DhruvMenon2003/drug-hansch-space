# Mechanical quote-location check, all 436 records

Run 2026-11-24 by the dataset thread. **No model calls, no cost to the allowance**: it extracts the text layer of
the stated PDF page with `pdftotext` and looks for the record's quote as a normalised substring (punctuation,
case and spacing ignored), trying the stated page and pages ±1 and ±2. Full per-record output:
`quote-location-check.json`. Nothing in any `chNN.json` was touched.

**It answers only one question: is the quoted string present in that page's text layer?** It cannot judge whether
the page supports the target, the target class or the chosen role. That judgement is the other thread's audit.

## Result

| Outcome | Records |
|---|---|
| Quote found exactly, on the stated page | 394 of 436 (90.4%) |
| Quote found as its longest unbroken piece, stated page | 2 |
| Quote not found on the stated page or within ±2 pages | 40 |
| Quote found, but on a different page than stated | 0 |

**No record points at the wrong page.** Every quote that was found at all was found on exactly the page the
helper gave.

## What the 40 are, grouped by where the helper said the text sits

| Where the helper said it is | Count | What this means |
|---|---|---|
| body text (all non-table, non-figure) | 21 | The page body text IS extractable, so these need explaining. Two were examined by hand (below); 19 are unexamined and listed in `quote-check-body-text-followups.json`. |
| table 1 or table 2 | 13 | Table content on these pages is not in the text layer. |
| figure label or figure caption | 5 | Text drawn inside the figure image. Invisible to text extraction by design. |
| figure 1, printed rotated | 1 | Same. |

(The 4 rows above total 40. The 2 partial matches counted in the result table are separate: they were found on the stated page, but only as the longest unbroken piece of a quote containing an ellipsis or bracket.)

## The two body-text cases examined by hand

Both quotes **are** on the stated page. They are near-verbatim with small transcription slips:

1. ch01 record 55, PDF p. 30, VU0155041.
   Helper: "…potency nearly 10-fold **that** of PHCCC"
   Book:   "…potency nearly 10-fold **of that** of PHCCC"
2. ch01 records 84-87, PDF p. 36, saclofen and others.
   Helper: "among these there are the baclofen derivatives, saclofen and **2-OH** saclofen"
   Book:   "among these **ligands** there are the baclofen derivatives, saclofen and **2OH** saclofen"

Both searched pages 27-34 and 34-40: the compound names appear only on the stated page. The page, the drug and
the mechanism are right in both; only the transcription drifts by a word or a hyphen.

## What this does and does not establish

- **Established:** no record cites a page that does not contain its subject, and 90.4% of quotes are exactly
  reproduced. On this evidence the extraction is not fabricating page references.
- **Not established:** that the 16 remaining unexamined body-text cases are also mere transcription slips. Two of
  eighteen were checked. The rest are unverified.
- **Not addressed at all:** whether each page actually supports the target class and the Agonist/Antagonist or
  Inhibitor/Activator role the helper chose. That is the substantive question and it is untouched here.
