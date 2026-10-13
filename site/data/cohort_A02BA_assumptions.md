# A02BA h2-receptor antagonists: how this table was filled

Built 2026-10-13T18:17:37+00:00 by `tools/build_cohort.py --atc4 A02BA`. 8 drugs, 9 rows, one per mode of administration.

## Formulas

- `therapeutic_index` = LOG10(in-vivo toxicity) - LOG10(1 / in-vivo activity)
- `therapeutic_index_classical` = LOG10(in-vivo toxicity / in-vivo activity)
- `free_concentration` = 1.44 * F * half-life(h) * dose(mg) / dose interval(h)
- `dose_corrected_bioavailability` = F / dose(mg)
- `in_vivo_activity` = WHO defined daily dose for the route, in mg, / 70 kg

## Where each column comes from

| Column | Source |
|---|---|
| Compound Identifier, Structure, PubChem XLogP3 | PubChem PUG REST, by generic name then by CID |
| Anatomical / Therapeutic / Chemical Group, ATC code, Dosage | the WHO ATC/DDD index page |
| Mechanism of Action, Primary Biological Target | ChEMBL mechanism records |
| Molecular Weight through Molecular Refractivity, QED | RDKit on the PubChem structure |
| Mode of Administration | openFDA label route counts, DailyMed SPL routeCode as the fallback |
| In Vitro Activity, In Vitro Toxicity | median ChEMBL pChEMBL at the primary target, and at the strongest other target |
| Bioavailability, Half Life, In Vivo Toxicity, Primary Toxicity Endpoint | read out of the US label text, with the sentence kept in the row |
| In Vivo Activity | the WHO defined daily dose for that route, in mg/kg |
| Therapeutic Index, In Vivo Free Drug Concentration, Dose-corrected bioavailability, Exposure flag | computed from the columns above by the formulas above |

## Assumptions and choices

- ranitidine bismuth citrate: the PubChem record is a mixture of 3 fragments, so the largest one is taken as the drug, as the curation rules require.
- cimetidine, combinations (A02BA51): PubChem has no single compound under this name (a combination or a salt-only entry), so the row is left out of the table.
- famotidine, combinations (A02BA53): PubChem has no single compound under this name (a combination or a salt-only entry), so the row is left out of the table.
- The primary biological target is taken to be CHEMBL1941 (Histamine H2 receptor): the mechanism target ChEMBL gives for 6 of the 8 members that have a structure.
- Hammet Substituent Constant is left empty in every row. A Hammett sigma is defined for a substituent on a fixed parent ring, and the members of this group differ in the ring itself, so no common parent exists and no sigma can be read off a table. Molar refractivity fills the steric half of the same column pair.
- Lipophilicity(log D) holds the Crippen log P computed by RDKit, with PubChem's XLogP3 kept beside it. Neither is a log D: a distribution coefficient at pH 7.4 needs each drug's pKa, which none of the sources used here publish.
- In Vivo Toxicity(Cell Culture) holds a whole-animal figure, the lowest acute lethal dose in mg/kg stated in the US label text, not a cell-culture figure. The workbook's own formula calls this cell the in-vivo toxicity parameter, and no cell-culture toxicity value for these drugs exists in the open sources used here.
- In Vivo Activity(Therapeutic Response) holds the WHO defined daily dose for that route, converted to mg/kg for a 70 kg adult. A DDD is the assumed average maintenance dose for the drug's main indication in adults, so it is a dose that produces the therapeutic response, and the WHO publishes it per route, which is what makes the per-route comparison possible.
- Therapeutic Index is computed exactly as the workbook writes it, LOG(toxicity) - LOG(1/activity), which equals log10(toxicity x activity). The conventional index, log10(LD50/ED50), is in its own column. The workbook's form is the right one when the activity cell holds a potency, where bigger means more active; the classical form is the right one when it holds a dose in mg/kg, which is the case here, so the classical column is the one to read.
- Dose Interval is 24 hours in every row, because a defined daily dose is one day's dose. A label's own dosing interval would differ by product and strength, and is not comparable across routes.
- Bioavailability and half-life are read out of the label prose by pattern, and each row keeps the sentence the number came from so it can be checked. Sentences about renal or hepatic impairment, children and neonates are skipped so the figure is the ordinary adult one.
- A drug appears once per mode of administration. Descriptors, structure, target and the in-vitro numbers are properties of the molecule, so they repeat across its route rows; bioavailability, dose and the free concentration are properties of the route, so they differ.

## Empty cells

- **Bioavailability** is empty in 7 row(s): cimetidine / ORAL, ranitidine / ORAL, nizatidine / ORAL, niperotidine / NaN, roxatidine / ORAL, ranitidine bismuth citrate / ORAL, lafutidine / ORAL
- **Dosage** is empty in 1 row(s): niperotidine / NaN
- **Half Life** is empty in 4 row(s): niperotidine / NaN, roxatidine / ORAL, ranitidine bismuth citrate / ORAL, lafutidine / ORAL
- **In Vitro Activity** is empty in 5 row(s): nizatidine / ORAL, niperotidine / NaN, roxatidine / ORAL, ranitidine bismuth citrate / ORAL, lafutidine / ORAL
- **In Vitro Toxicity** is empty in 3 row(s): niperotidine / NaN, roxatidine / ORAL, ranitidine bismuth citrate / ORAL
- **In Vivo Activity** is empty in 1 row(s): niperotidine / NaN
- **In Vivo Toxicity** is empty in 7 row(s): cimetidine / ORAL, famotidine / ORAL, famotidine / INTRAVENOUS, niperotidine / NaN, roxatidine / ORAL, ranitidine bismuth citrate / ORAL, lafutidine / ORAL
