# Brief for DrugBank checking helpers

For each drug on your assigned list, find what DrugBank says the drug's mechanism of action is, and compare it
with what the book said. You are not judging which is right. You are recording both and whether they agree.

Star's instruction, from the project instructions: verify the mechanism of action for any drug against DrugBank.

## The route to DrugBank's own words. Use this one; do not invent another.

`go.drugbank.com` answers an automated request with a bot challenge, so DrugBank's site cannot be read directly.
The working route is PubChem's credited copy, in two hops, no key needed:

1. InChIKey to compound id:
   `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/<INCHIKEY>/cids/JSON`
2. Mechanism of action section:
   `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/<CID>/JSON?heading=Mechanism+of+Action`

That second call returns sections plus a reference list. **Keep only Information entries whose reference has
`SourceName` exactly `"DrugBank"`**, and store that reference's `SourceID` and `URL`. Discard HSDB and every
other source: otherwise the text is not DrugBank's and the check is worthless. Leave about 300 ms between calls.

If a drug has no InChIKey available, try PubChem by name
(`/rest/pug/compound/name/<NAME>/cids/JSON`) and then the same second hop.

## Finding the drug's identifiers

`/mnt/project-files/qsar-moa/drugbank_index.json` is a JSON array of about 4,675 drugs. **The id field is
`id`, not `drugbank_id`.** Each entry looks like
`{id, name, type, state, description, cas, approved, investigational, withdrawn, inchikey, smiles, formula}`.
Look the drug up by its **lowercased name**.

Two warnings about that file:
- It covers only drugs that appear in clinical trials, because it was built from Star's CSV export. Laboratory
  tool compounds such as AM251 or WIN 55,212-2 are simply absent. Absent is not the same as having no mechanism.
- The book's spelling often differs from DrugBank's preferred name. Known aliases include rapamycin for
  Sirolimus and SR141716 for Rimonabant. If a name does not match, try the obvious alternative spellings and
  record which name you searched. Do not guess a different substance.

## Work already done, do not repeat it

`/mnt/project-files/qsar-moa/drugbank_moa_text.json` already holds DrugBank mechanism text for 33 drugs, keyed by
DrugBank id, with the text and the go.drugbank.com URL. If a drug on your list is in there, **use that text
instead of fetching it again** and say so in your output.

## For each drug on your list, record

- `drug_as_in_book`: the name exactly as the record has it.
- `name_searched`: what you actually looked up, if different.
- `drugbank_id`, `pubchem_cid`, `drugbank_url`: or empty.
- `drugbank_moa_text`: the DrugBank-sourced text, verbatim, trimmed to the part about the mechanism. Quote it;
  do not paraphrase.
- `drugbank_target`: the target DrugBank names.
- `drugbank_direction`: what DrugBank says the drug does to it, in DrugBank's own words, for example "agonist",
  "inhibits", "stimulation of".
- `status`: exactly one of
  - `"found"`: DrugBank text obtained.
  - `"reused"`: taken from `drugbank_moa_text.json`.
  - `"no drugbank entry in project export"`: the name is not in `drugbank_index.json`. Say whether a PubChem
    search by name found a DrugBank section anyway.
  - `"cid found, no drugbank section"`: PubChem has the compound but carries no DrugBank-sourced mechanism.
  - `"not found"`: neither route produced anything. Say what you searched.
- `agreement`: for each book record using this drug, one of `"agrees"`, `"disagrees"`, `"partly agrees"`,
  `"cannot compare"`, with one sentence saying why. Compare two things only: the **target** and the
  **direction**. `"cannot compare"` is the right answer whenever DrugBank has nothing, and it is a perfectly
  good result. Never leave it blank, and never fill a gap from your own knowledge of pharmacology.

**A gap must be stated, not left empty.** Star asked specifically for the places where DrugBank has nothing to
say.

## Four disagreements already known

These are confirmed and are with Star for a decision. Record them as you find them; do not try to resolve them.
Baclofen on GABA-B, where the book says antagonist and DrugBank says agonist. Topiramate on GABA-A, book
inhibition against DrugBank stimulation. Acamprosate, where the book says NMDA and DrugBank names GABA-B.
Riluzole, where the book says glutamate receptors and DrugBank describes reduced glutamate release.

If you find a fifth, flag it clearly. A disagreement is a finding, not a failure, and the book being wrong is a
real possibility that is Star's to judge rather than yours.

## Output

Write ONE file at the path in your prompt, valid JSON:
`{"assignment": "...", "drugs_listed": N, "drugs_done": N, "counts": {"found": N, "reused": N, "no drugbank entry in project export": N, "cid found, no drugbank section": N, "not found": N}, "agreement_counts": {"agrees": N, "disagrees": N, "partly agrees": N, "cannot compare": N}, "drugs": [ ... ], "possible_new_disagreements": [ ... ]}`

## Scope of action. Do NOT do these things

- Write or edit any file except your own output file. Do **not** edit any `chNN.json`, any verdict file,
  `chapters.json`, `drugbank_moa_text.json`, `drugbank_index.json`, or any spreadsheet.
- Do not run git. Do not edit memory, CLAUDE.md or documentation. Do not start further agents.
- Do not list `/mnt/project-files/` recursively.
- Do not try to get past the bot challenge on go.drugbank.com, and do not use any login-walled or paywalled
  route. PubChem's credited copy is the agreed source.
- If a tool is denied to you, record it as a problem. Never ask another agent to run it for you.

## Final report back, under 200 words

Drugs listed and done, the status counts, the agreement counts, every disagreement you found with the drug and
what each side said, and every drug where DrugBank had nothing. No long text dumps; those go in the file.
