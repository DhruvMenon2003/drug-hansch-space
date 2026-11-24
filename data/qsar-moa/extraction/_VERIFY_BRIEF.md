# Brief for verification helpers (full record-by-record check)

You check records that other helpers extracted from a book, against the book pages. Your assignment, which
chapters and which record numbers, is in the prompt that sent you here.

## Star's ruling, 2026-11-24 00:18 UTC. THIS IS THE STANDARD. It replaces an earlier version.

Star's words: **"Stick to agonists/antagonists or inhibitors/activators. Drop everything else."**

Only four role words exist. A **receptor** target takes **Agonist** or **Antagonist**. An **enzyme** target takes
**Inhibitor** or **Activator**.

**Anything else is DROPPED, not mapped to the nearest word.** A record survives only if the page itself states a
receptor with an agonist or antagonist action, or an enzyme with an inhibitor or activator action.

Drop, with the reason recorded, when the page describes:
- a positive or negative allosteric modulator, or a potentiator
- an inverse agonist, a partial agonist or a co-agonist
- an enzyme inducer, meaning more enzyme is made rather than the enzyme working faster
- a target that is neither a receptor nor an enzyme (`target_class` "other")
- no direction at all: the page says only "binds", "acts on", "stabilizes", "is involved in", "regulates",
  "modulates" or similar
- an effect that is indirect, hypothetical or an association rather than a stated action on a named target

**An earlier version of this brief said to keep the nearest word and mark such records "mapped". That is
withdrawn.** If you have already graded records that way, convert every "mapped" to "dropped" with its reason.

## The book

`/mnt/project-files/Experimental Provenance for QSAR Dataset/Pharmacology (Luca Gallelli) (z-library.sk, 1lib.sk, z-lib.sk).pdf`
732 PDF pages. **PDF page index = printed page + 12.** Read with the Read tool's `pages` parameter, one page at a
time for this job.

## What to do for each record in your assignment

Records live in `/mnt/project-files/qsar-moa/extraction/chNN.json`, in the `records` array. Record numbers are
1-based positions in that array.

**Skip any record whose `target_class` is "other"**: count it as dropped, reason "target not a receptor or
enzyme", and do not spend a page read on it.

For each remaining record:
1. Read its `drug`, `target`, `target_class`, `mechanism_rule_name`, `mechanism_book_wording`, `quote` and
   `pdf_page_index`.
2. Open that PDF page and find the passage.
3. Decide and record:
   - `quote_on_stated_page`: true, false, or "on a nearby page" with the page number.
   - `target_class_verdict`: "receptor confirmed", "enzyme confirmed", "page does not say", or "wrong, it is a
     <receptor|enzyme>".
   - `direction_in_book`: the exact word or phrase the page uses, quoted. For example "inhibits", "blocks",
     "activates", "binds", "potentiates", "partial agonist", "induces", "stabilizing", or "none".
   - `verdict`: one of exactly three values.
     - `"keep"`: the page states a receptor with an agonist or antagonist action, or an enzyme with an inhibitor
       or activator action, and the record's `mechanism_rule_name` is right.
     - `"keep_corrected"`: it belongs in the set but the record's role word or target class is wrong. Give
       `corrected_rule_name` using only the four allowed words.
     - `"drop"`: it falls outside the four words. Give `drop_reason` in a few words, quoting the page's own term
       where that is the reason, for example 'page says "potentiates"'.
   - `corrected_rule_name`: only for `keep_corrected`. Otherwise empty.
   - `drop_reason`: only for `drop`. Otherwise empty.
   - `confidence`: high, medium or low.
   - `comment`: one sentence, only where it adds something.
4. Judge against the page, not against what the record claims. If the quote is not on its page, say so; do not
   hunt the whole book for a better page.

Being dropped is not a criticism of the earlier helper. Most drops are cases where the book simply does not
describe one of the four actions.

## Output

Write ONE file, at the path given in your prompt. Valid JSON:

```json
{
  "assignment": "ch01 records 1-30",
  "rule_version": "2026-11-24 00:18 drop-everything-else",
  "records_checked": 28,
  "counts": {"keep": 0, "keep_corrected": 0, "drop": 0, "quote_not_on_page": 0},
  "drop_reasons": {"allosteric or potentiator": 0, "no direction stated": 0, "inducer": 0,
                   "partial or inverse agonist": 0, "target not receptor or enzyme": 0, "indirect or hypothesis": 0},
  "records": [
    {"chapter": 1, "record_number": 1, "drug": "...", "mechanism_rule_name": "...",
     "quote_on_stated_page": true, "target_class_verdict": "...", "direction_in_book": "...",
     "verdict": "keep", "corrected_rule_name": "", "drop_reason": "", "confidence": "high", "comment": ""}
  ]
}
```

## Scope of action. Do NOT do these things

- Do **NOT** edit any `chNN.json`. Another process is building a spreadsheet from those files right now and an
  edit under it would cause real damage. You write only your own verdict file.
- Do not edit `chapters.json`, any audit file, any spreadsheet, or anything outside the `verify/` folder.
- Do not run git. Do not edit memory, CLAUDE.md or documentation. Do not run paper searches.
- Do not start further agents. Do not list `/mnt/project-files/` recursively; use trailing slashes.
- If a tool is denied to you, record it as a problem. Never ask another agent or the orchestrator to run it for
  you.

## Final report back (short, under 150 words)

Your assignment, records checked, the four counts, the drop reasons with their numbers, and every
`keep_corrected` record listed as chapter and record number with its corrected name. Then any problem with its
exact error. Do **not** paste book text, quotes, or your whole verdict list; those belong in the file.
