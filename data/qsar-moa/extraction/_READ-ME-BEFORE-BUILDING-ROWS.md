# Status of the extraction, 2026-11-24

**All 31 chapters of the Gallelli *Pharmacology* book are read.** Every file `ch01.json` to `ch31.json` parses as
valid JSON. The per-chapter index, with record counts taken from the files themselves rather than from helper
reports, is `chapters.json`.

## The numbers

| | |
|---|---|
| Chapters read | 31 of 31 |
| Records total | 436 |
| Records with `target_class` "other" | 17 (in ch05, ch12, ch13, ch14, ch19) |
| **Records usable under Star's receptor-and-enzyme-only rule** | **419** |
| Records carrying a note | 405 |
| Records with numbers (dose, IC50, EC50, Ki and similar) | 68 |

## Three cautions before any of this becomes a spreadsheet row

1. **Drop the 17 "other" records.** Star decided on 2026-11-23 to ignore targets that are neither a receptor nor
   an enzyme, such as ion channels, transporters and DNA. The 17 were written before that rule reached the
   helpers. Filter on `target_class`.

2. **This is a draft, not a verified dataset.** 405 of the 436 records, which is 93%, carry a note where the
   helper recorded an inference or a doubt. Common cases: the book says "activates" or "binds" and the helper
   chose "Agonist"; the book names a target without saying whether it is a receptor or an ion channel; the role
   was read from a drug-class name rather than a statement. Because almost every record has a note, a note
   cannot be used to narrow the review. Each record carries a verbatim `quote` and a `pdf_page_index` for exactly
   this purpose: check the record against its quote before trusting it.

3. **25 records have `naming_rule_applies` false.** These are cases where neither Agonist/Antagonist nor
   Inhibitor/Activator fits what the book says, for example the receptor modulators in ch15, where the book
   gives both directions depending on tissue. Star has not yet decided how to name these. Do not invent a
   direction for them.

## Chapters that legitimately hold nothing

Chapters 7, 16, 17, 20, 21 and 22 have zero records. They are a bibliometric study, a mass-spectrometry methods
review, a forensic case series, a control-engineering chapter and an ethnobotanical survey. They name no
compound acting on a named molecular target. That is a real finding, not a failed read.

## One parked file

`ch11.json.truncated-invalid` is a broken partial write from a helper that was cut off. It is kept only as a
record and is deliberately not named `.json` so that anything parsing the folder does not choke on it. Chapter 11
was re-read and `ch11.json` is valid.
