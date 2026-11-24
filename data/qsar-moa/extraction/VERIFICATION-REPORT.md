# Verification report: mechanisms of action read from the book

Date: 24 November 2026. Book: *Pharmacology*, edited by Luca Gallelli (InTech, 2012), 31 chapters, 732 PDF pages.
Folder: `/mnt/project-files/qsar-moa/extraction/`.

## 1. The result in five lines

| Question | Answer |
|---|---|
| How many mechanism records did the reading produce? | 436, from 31 chapters |
| How many survive your rule (receptor = agonist or antagonist, enzyme = inhibitor or activator, drop everything else)? | **270 kept, 166 dropped** |
| How many kept records had the wrong name? | 0. None needed renaming |
| How many kept records could be checked against DrugBank? | 62 of 270. For the other 208 DrugBank has nothing to compare |
| Of those 62, how many agree with DrugBank? | 45 agree, 4 partly agree, 13 do not match (2 contradict, 11 name a different target) |

## 2. Check against the book

Every one of the 436 records was opened beside its page in the book by a helper agent and graded.

**Why 166 were dropped**

| Reason | Records |
|---|---|
| The book states no direction (it says only "binds", "acts on", "is involved in") | 42 |
| The effect is indirect, or the book offers it as a hypothesis ("may", "probably") | 41 |
| Allosteric modulator or potentiator: changes the receptor's response without switching it on or off | 37 |
| The target is not a receptor or an enzyme (ion channel, transporter, DNA) | 18 |
| Enzyme inducer: the body makes more of the enzyme; the enzyme itself does not work faster | 11 |
| Partial agonist, inverse agonist or co-agonist | 11 |
| Acts in both directions depending on the tissue (the book's word is "modulator") | 5 |
| Target not named as a receptor | 1 |

Being dropped is not a fault in the reading. In most cases the book simply does not describe one of your four
actions.

**How plain wording was treated (assumption 1).** A sentence such as "inhibiting the function of the NMDA
receptor" was kept as *NMDA Receptor Antagonist*, and "activated by fatty acids" as *Agonist*, although the noun
"agonist" or "antagonist" is not printed. Without this reading, chapter 6 on PPAR agonists and fibrates would
lose most of its records.

**Two close calls kept in the files for your review.** Chapter 13 record 14: metformin, "suppress S6K1
activity", kept. Chapter 28 record 18: inosine, "in a direct or indirect way activates A1R", dropped.

## 3. Check against DrugBank

Your project instruction: verify the mechanism of action for any drug against DrugBank.

The 270 kept records use 184 different compound names. A few are the same drug written two ways, for example "Baclofen" and "baclofen". 37 records name no compound (the book gives a drug class only).

| Compound names | Count |
|---|---|
| DrugBank has "Mechanism of action" text | 55 |
| Not in DrugBank: looked up, no mechanism text | 127 |
| Not in DrugBank: no entry found (aspirin under that name, Ni-NQTS) | 2 |

Most of the book's compounds are laboratory research compounds, for example AM251, DPCPX and the CGP series.
DrugBank lists drugs, so it does not cover them. That is why only 62 of the 270 records can be compared.

DrugBank's website refuses automated reading. Its text was taken from PubChem, which republishes DrugBank's
mechanism section and credits it. Only text credited to DrugBank was used. Lookup dates are stored per record.

**The 13 records that do not match DrugBank**

*Opposite direction (2). These are real contradictions.*

| Drug | The book says | DrugBank says | Record |
|---|---|---|---|
| Baclofen | GABA-B receptor antagonist | GABA-B receptor agonist | ch12 r6 |
| Topiramate | inhibition of GABA-A receptors | stimulates GABA-A receptor activity | ch12 r9 |

In both, the record is a faithful copy of the book. The page really prints that wording. So the conflict is
between the book and DrugBank, not a reading mistake.

*DrugBank names a different target and does not mention the book's (11). These are silences, not contradictions.*

| Drug | The book's target | Record |
|---|---|---|
| Acamprosate | NMDA receptor (DrugBank names GABA-B) | ch12 r4 |
| Riluzole | glutamate receptors (DrugBank describes reduced glutamate release) | ch14 r19 |
| Fenofibric acid | PPAR-gamma | ch6 r8 |
| Quinidine | CYP2D6 | ch9 r17 |
| Omeprazole | CYP2C19 and CYP2C9 | ch11 r1, r2 |
| Lansoprazole | CYP2C19 | ch11 r3 |
| Fluvoxamine | CYP2C19 | ch11 r4 |
| Disulfiram | dopamine beta-hydroxylase | ch12 r2 |
| Aminoguanidine | histaminase and nitric oxide synthase | ch30 r1, r2 |

Several of these are a drug blocking a liver enzyme that breaks down other drugs. DrugBank's mechanism section
describes a drug's main intended action and lists such enzyme effects elsewhere, so its silence here does not
show the book is wrong.

**Assumption 2.** None of these 13 was changed or removed. Each is kept with both statements side by side, for
you to decide.

**Two compounds treated as "cannot compare" on purpose.** DPMA and MCCG are abbreviations that could mean more
than one substance, so they were not matched by name.

## 4. Was anything missed?

The checks above ask whether the records are right. A separate check asked whether mechanisms were left out.

Four helpers re-read 39 pages, chosen by a fixed rule (the third page of a chapter's text, then every fifth
page) in 11 chapters. Each listed the mechanisms on the page before looking at the records.

**Result: 50 mechanisms found, all 50 already recorded, 0 missed.**

**Assumption 3.** This is a sample, not the whole book. No miss in 50 means the true miss rate could still be up
to about 6 percent. 25 further sentences were set aside as unclear and are listed in the files.

## 5. Things that went wrong, and what was done

1. **A helper invented results.** It wrote judgements for chapter 28 records 50 to 60. Chapter 28 has 49
   records. Its whole file was thrown away and the chapter was checked again. Every other file was then tested
   by counting records, and all passed.
2. **Helpers tidied the book's spelling.** 21 quotes had a typo corrected or a word changed. The book's exact
   wording was restored, and the tidied version kept in a separate field.
3. **A claim of a missed mechanism was wrong.** One helper said the book's topiramate sentence had no record. The
   file has it. The claim was withdrawn.
4. **A first count of DrugBank coverage was wrong** (41 names with text). The corrected count is 55.

## 6. What has not been checked

- None of the JSON files written by helpers in `verify/` and `recall/` was tested with a JSON parser by me. My
  session cannot run one. Counts in this report were made by counting lines in the files.
- The DrugBank comparison was made by one helper and has not been checked by a second.
- The 37 records that name a drug class, not a compound, cannot be checked against DrugBank at all.

## 7. Files

| File | What it holds |
|---|---|
| `ch01.json` to `ch31.json` | the 436 records, with the book's sentence and page for each |
| `chapters.json` | per-chapter index and counts |
| `verify/v-*.json` | keep or drop for every record, with the reason |
| `verify/consistency-pass.json` | the second pass that rescued 2 records |
| `verify/surviving-records.json` | the 268 kept records (add ch12 r9 and r15 to make 270) |
| `verify/drugbank-comparison.json` | book against DrugBank for all 270 kept records |
| `verify/drugbank-worklist.tsv`, `drugbank-aliases.tsv`, `drugbank-extra-lookups.tsv` | the DrugBank lookups |
| `recall/recall-A.json` to `recall-D.json` | the missed-mechanism sample |
