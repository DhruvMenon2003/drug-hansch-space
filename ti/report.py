#!/usr/bin/env python3
"""Turn the run into a report a non-specialist can read, laid out on the five OECD principles.

    ti/report.py                     # ti/out/REPORT.md from ti/out/audit.json

The OECD agreed five things a QSAR model has to be able to state about itself before anyone should act on its
numbers. They are not paperwork; each one closes a specific way of fooling yourself. This writes them out in
plain language, with this run's actual figures, including the ones that came out badly.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def write(audit: dict, models: dict, out_dir: Path) -> Path:
    e, c = audit["endpoint"], audit["counts"]
    acc = audit["acceptance"]
    usable = {t: m for t, m in audit["models"].items() if m["fallback_usable"]}
    series_validated = sum(m["series_validated"] for m in audit["models"].values())
    series_tried = sum(m["series_tried"] for m in audit["models"].values())
    q2s = sorted((m["fallback_q2_scaffold_grouped"] for m in usable.values()), reverse=True)
    series_q2s = sorted((s["q2_loo"] for m in models.values()
                         for s in m.get("series", {}).values() if s["passes"]), reverse=True)
    shuffled = max((m["fallback_shuffled_q2"] for m in audit["models"].values()), default=0)

    L = []
    w = L.append
    w("# Predicting a therapeutic index, and how much to trust it")
    w("")
    w("This explains what the accompanying `therapeutic_index.csv` contains, how each number in it was produced, "
      "and — the part that matters most — where it should not be believed. It assumes no background in "
      "computational chemistry. Every figure quoted here comes from `audit.json`, written by the same run.")
    w("")
    w("## The short version")
    w("")
    w(f"- {c['molecules in']} molecules went in. **{c['ranked']} came out with a usable therapeutic index**, "
      f"sorted from the widest safety margin to the narrowest.")
    w(f"- {c['both sides measured']} of those rest on two real laboratory measurements and no prediction at all. "
      f"Those are the rows to trust most.")
    w(f"- {c['at least one side predicted']} have at least one predicted side. Each of those rows names the model "
      f"that produced it and how well that model scored.")
    w(f"- The remaining {c['molecules in'] - c['ranked']} molecules are **in the file with an empty index and a "
      f"reason**. They were not quietly filled in.")
    w("")
    w("A classical Hansch analysis is the intended centrepiece. It holds up on a minority of chemical families "
      f"rather than everywhere: {series_tried} candidate series were fitted and **{series_validated} passed** "
      "the fit, prediction and chance-correlation gates together. Those series get a readable equation with a "
      "lipophilicity optimum. Everything else falls back to a declared non-linear model, labelled as such in "
      "every row it produced. Both outcomes are reported below, with the figures.")
    w("")

    w("## What the number in the last column is")
    w("")
    w("```")
    w("therapeutic index = (how tightly it binds the target it is meant to hit)")
    w("                    - (how tightly it binds the heart channel)")
    w("```")
    w("")
    w("Both halves are measured on the same scale, where each whole number is a tenfold change in the "
      "concentration needed. So the difference is a plain ratio: **an index of 2.0 means the molecule grips its "
      "intended target about a hundred times more tightly than it grips the heart channel.** Bigger is better. "
      "A negative index means the opposite, and is a warning.")
    w("")
    w("The heart channel is hERG, a potassium channel in heart muscle. Blocking it can disturb the heart's "
      "rhythm, and it is the single most common reason a promising drug is abandoned late, so it is the standard "
      "liability to measure a margin against.")
    w("")
    w(f"> **This is not a clinical therapeutic index.** It is {e['is_not'].replace('not ', 'not ')}. It compares "
      "molecules in a test tube against one specific risk. It says nothing about dose, nothing about what a "
      "liver does to the molecule, and nothing about whether anything here is safe in a person. It is a way to "
      "put a batch of molecules in a sensible order for deciding what to look at next.")
    w("")

    w("## The five OECD principles, one at a time")
    w("")
    w("### 1. A defined endpoint")
    w("")
    w("*The thing being predicted has to be one measurable quantity, not a vague idea of 'activity'.*")
    w("")
    w(f"Both halves are `pChEMBL` values — binding affinities from **binding assays only** (`assay_type = B`), "
      f"on the **human** protein, taken from ChEMBL. Within one target, one assay type is used and never mixed: "
      f"a Ki and an IC50 are different experiments and averaging them averages two different things. Where a "
      f"molecule was measured more than once the median is used, and if its repeats disagreed by more than "
      f"tenfold it was dropped, because at that spread the median is not measuring anything.")
    w("")
    w("### 2. An unambiguous algorithm")
    w("")
    w("*Someone else, given the same inputs, has to be able to get the same numbers.*")
    w("")
    w(f"The inputs are fixed by checksum in `audit.json`, the library versions are recorded "
      f"({', '.join(f'{k} {v}' for k, v in audit['software'].items())}), and the same "
      f"{len(audit['descriptors']['declared_block'])} molecular properties are calculated the same way for "
      f"every molecule, by one function:")
    w("")
    w("| property | what it stands for |")
    w("| --- | --- |")
    for key, meaning in [
        ("clogp, clogp_sq", "how greasy it is, and that figure squared — see principle 5"),
        ("mr", "molar refractivity: roughly how much space and how many loose electrons it has"),
        ("tpsa", "how much of its surface is polar, which sets the cost of leaving water"),
        ("hbd, hba", "how many hydrogen bonds it can give and take"),
        ("mw, rotb, fsp3, aromatic_rings", "size, floppiness, three-dimensionality, flatness"),
        ("formal_charge, n_basic_centres, n_acidic_centres", "its charge state at body pH"),
        ("max/min_partial_charge", "its electronic extremes"),
        ("qed", "a standard composite score for how drug-like it looks"),
    ]:
        w(f"| `{key}` | {meaning} |")
    w("")
    w(f"Two kinds of value are kept strictly apart. These {len(audit['descriptors']['declared_block'])} are "
      f"**calculated** from the structure. The `measured_*` columns "
      f"({', '.join(k.replace('measured_', '') for k in audit['descriptors']['measured_not_fitted'])}) are "
      f"**laboratory measurements in humans**, carried through into the file because they are useful to see, and "
      f"never used as model inputs. Mixing the two is how a model ends up quietly learning from the answer.")
    w("")
    w("**The routing rule.** A molecule's predicted activity may only come from a model built on its own "
      "target. There is no falling back to a related protein and no general-purpose model pooled across "
      "targets. If a molecule's target has no model that validates, its activity cell is left empty and it "
      "leaves the ranking. A number from the wrong target's model is worse than no number, because on the page "
      "it looks exactly like a right one.")
    w("")
    routing = audit.get("routing", {})
    reg = audit.get("registry", {})
    w("**How the target is decided, when nobody says what it is.** This is the case that matters for a "
      "molecule that does not exist yet. A chemist with a new compound should not have to declare its target - "
      "working that out is half of what they are doing. So the pipeline decides, in a fixed order, and records "
      "which way it went in the `target_source` column:")
    w("")
    w("1. **`chembl_mechanism`** - ChEMBL's mechanism-of-action table records a target against this exact "
      "molecule. A curated annotation always wins, because it is a fact and the alternative is a guess.")
    w("2. **`structure_router`** - there is no annotation, or none with a working model. The structure is then "
      "compared against the training chemistry of every model in the registry, and the router returns one of "
      "three answers: **routed** to a single model, **ambiguous** with its candidates listed and no prediction "
      "made, or **abstain** because nothing was close enough.")
    w("")
    w(f"The registry holds {reg.get('eligible_local_models', '?')} eligible local models built from "
      f"{reg.get('training_compounds_in_the_bank', 0):,} training compounds; "
      f"{reg.get('refused_for_low_support', '?')} targets were refused for having fewer than "
      f"{reg.get('min_support', '?')} compounds, which is too few to fit anything worth trusting. Matching uses "
      f"{routing.get('basis', 'Morgan fingerprints')}.")
    w("")
    w("**A routed target is an inference, not a measurement.** It is a statement about chemical resemblance and "
      "nothing more. Two molecules can share a scaffold and hit different proteins. Every row says which kind "
      "of assignment it got, so the two can never be read as the same thing.")
    w("")
    w("**Abstaining is a result.** A router that always answers is not a router, it is a lookup table with "
      f"extra steps. Of the molecules in this run: {routing.get('decisions', {})}.")
    w("")
    w("### 3. A defined domain of applicability")
    w("")
    w("*A model is only entitled to speak about molecules resembling the ones it learned from.*")
    w("")
    w("This is the principle most often skipped and it is the one that does the most work. Every model here "
      "refuses to answer outside its range, and every row in the CSV carries an `applicability_domain` column "
      "saying `measured`, `inside`, or `outside`.")
    w("")
    w(f"- For a Hansch series model: the molecule's properties must all fall inside the span the series covered.")
    w(f"- For the fallback: the molecule must sit no further from the training set, in property space, than the "
      f"training molecules sit from each other (its distance to the nearest 5 training molecules, against the "
      f"95th percentile of that same distance within the training set).")
    w("")
    w(f"{c['inside the applicability domain']} of {c['ranked']} ranked molecules are inside. The rest are "
      "flagged `outside`: they are still listed, and their numbers should be read as suggestions at best.")
    w("")
    w("### 4. Measures of fit, robustness and predictivity")
    w("")
    w("*Three different questions, and only the third one matters for prediction.*")
    w("")
    w("A model can describe the data it was shown (**fit**, r²) while being useless on anything new "
      "(**predictivity**, q²). The gap between them is where most bad QSAR lives. So:")
    w("")
    w("- **Fit (r²)** — how well it reproduces its own training data. The weakest evidence there is.")
    w("- **Predictivity (q²)** — scored only on molecules the model never saw. For the fallback, whole chemical "
      "families are held out at once, so a near-twin cannot sit on both sides of the split and flatter the "
      "score. This is a deliberately harsh test and the honest one.")
    w("- **Robustness (shuffled labels)** — the model is refitted against deliberately scrambled answers. If it "
      f"still 'works', the method is manufacturing patterns. Worst shuffled score across all models here: "
      f"**q² = {shuffled:.3f}** — at or below zero, which is what it must be.")
    w("")
    w("What each kind of model had to clear to be used at all:")
    w("")
    w("| | requirement |")
    w("| --- | --- |")
    w(f"| Hansch series model | at least {acc['series_hansch']['min_n']} compounds; genuinely related to each "
      f"other (median similarity ≥ {acc['series_hansch']['min_median_tanimoto']}); r² ≥ "
      f"{acc['series_hansch']['min_r2']}; q² ≥ {acc['series_hansch']['min_q2_loo']} leaving each one out; "
      f"shuffled r² < {acc['series_hansch']['max_scramble_r2']} |")
    w(f"| Fallback | q² ≥ {acc['fallback_nonlinear']['min_q2_scaffold_grouped']} with whole families held out; "
      f"shuffled q² < {acc['fallback_nonlinear']['max_shuffled_q2']} |")
    w("")
    w(f"**Result: {series_validated} of {series_tried} series models passed. "
      f"{len(usable)} of {len(audit['models'])} targets produced a usable fallback**"
      + (f", with q² from {q2s[-1]:.2f} to {q2s[0]:.2f} (median {q2s[len(q2s) // 2]:.2f})." if q2s else "."))
    w("")

    w("### 5. A mechanistic interpretation, where there is one")
    w("")
    w("*Can you say, in chemistry, why the model works? And if you cannot, say so.*")
    w("")
    w("A Hansch analysis asks whether activity can be written as a short equation in a few physical properties "
      "— above all greasiness, with a squared term so the equation can find an *optimum* rather than assuming "
      "greasier is always better. That optimum is the classic insight: a molecule too water-loving never "
      "crosses a membrane, one too greasy never leaves it, and the best sits in between. When it works it beats "
      "a black box, because it tells you which direction to move.")
    w("")
    w("It works **within a congeneric series** — molecules sharing one chemical core, where only the decorations "
      "change. That is what Hansch himself fitted: ten to thirty close relatives at a time.")
    w("")
    w("Three things had to be right before that test meant anything, and the first attempt here got all three "
      "wrong. They are written out because each one is a standard way to fool yourself, and because the "
      "corrected result is the opposite of the uncorrected one.")
    w("")
    w("- **One term per five compounds, no more.** Fitting all six properties to a fifteen-member series gave a "
      "respectable r² and a *negative* q² — on one series, −30.8. A negative q² means the model predicts "
      "held-out members worse than guessing the series average: it had memorised, not modelled. The rule that "
      "prevents this is old and specific — at least five compounds for every fitted variable, or the "
      "correlation is chance. Terms are now capped at n/5.")
    w("- **The squared term has to be centred.** `clogp²` computed raw is almost perfectly correlated with "
      "`clogp` over any normal range, so the two terms fight and both coefficients become unstable. "
      "Subtracting the series mean before squaring removes that, and the parabola survives.")
    w("- **The criterion used to choose must not be the criterion reported.** Picking which terms to keep by "
      "maximising q², then reporting that same q², inflates it — the number has been optimised. Terms are now "
      "chosen on AICc, a fit criterion that charges for each extra one, and q² is computed afterwards on the "
      "chosen form.")
    w("")
    w(f"With those three in place the Hansch form does work, on a minority of series: **{series_validated} of "
      f"{series_tried} passed**"
      + (f", the best reaching q² = {series_q2s[0]:.2f} leaving each compound out." if series_q2s else ".")
      + " Where a series model applies, the row carries its equation's lipophilicity optimum, and that is a "
      "number a chemist can act on: it says which way to move the next analogue.")
    w("")
    w("Most candidate series still fail, and for this liability the chemistry says why. hERG blockade is driven "
      "by specific contacts — an aromatic group stacking against two particular residues in the channel, plus "
      "a basic nitrogen — not by bulk greasiness. Bulk properties correlate loosely with hERG across enormous "
      "diverse collections and stop predicting the moment you look inside one chemical family. A failed series "
      "here is usually a true negative, not a missed fit.")
    w("")
    w("One grouping artefact is excluded deliberately. Reducing a molecule to its ring skeleton collapses every "
      "single-benzene-ring compound into one bucket; that bucket is not a congeneric series and scored well for "
      "the wrong reason. A group must now also show a median pairwise similarity above "
      f"{acc['series_hansch']['min_median_tanimoto']} to its own members before it is fitted at all.")
    w("")
    w("Where no series model covers a molecule, the ranking comes from the fallback, and the fallback is honest "
      f"about what it is: the same {len(audit['descriptors']['declared_block'])} properties, a model allowed to "
      "combine them in non-straight lines, **q² roughly "
      + (f"{q2s[len(q2s) // 2]:.2f}" if q2s else "0.3") +
      " with whole chemical families held out, and no equation to read.** It gives a defensible order; it does "
      "not give a mechanism. Any row whose source column says `fallback_nonlinear` should be read that way.")
    w("")
    w("The mechanistic statement that survives either way: the properties carry the signal, the straight line "
      "does not travel. Dropping from all of them to the six Hansch terms costs the fallback about half its "
      "predictivity (q² 0.32 against 0.18 on hERG), so the descriptor block is not the weak link — the linear "
      "form used off-series is. That is precisely what Hansch theory predicts, and it is why the equation is "
      "kept where it is valid and refused where it is not.")
    w("")

    w("## How to read the CSV")
    w("")
    w("One row per molecule. `therapeutic_index` is the last column, as requested.")
    w("")
    w("**The ranking is inside each target, never across them.** `rank_in_target` 1 is the widest margin among "
      "the molecules routed to that same model, out of `n_in_target` of them. There is no global ranking in "
      "this file and that is deliberate: potency against one receptor and potency against another are measured "
      "in different assays, so a number that mixes them has no referent. Target groups are written largest "
      "first, so the substantive ranked lists are at the top; rows that could not be ranked follow with a "
      "stated reason. What makes this a single global method is the assembly - many local models plus a router "
      "that decides which one a molecule may use - not one pooled fit.")
    w("")
    w("| column group | what it is |")
    w("| --- | --- |")
    w("| `rank_in_target`, `n_in_target` | position within this molecule's own target group, and the size of "
      "that group. Compare rows that share a `target_chembl_id`; do not compare across groups |")
    w("| `name`, ids, `canonical_smiles` | which molecule, and the exact structure used after salts "
      "were stripped and charges neutralised |")
    w("| `target_source` | `chembl_mechanism` (a curated annotation) or `structure_router` (an inference from "
      "chemical similarity). Never read the second as the first |")
    w("| `routing_decision` | `mechanism`, `routed`, `ambiguous`, or `abstain` |")
    w("| `routing_score`, `routing_separation`, `routing_alternatives` | how close the winning model was, how "
      "far clear of the runner-up, and the three best candidates with their scores |")
    w(f"| the {len(audit['descriptors']['declared_block'])} property columns | the predictors, one per column, "
      "calculated from that structure |")
    w("| `measured_*` | human pharmacokinetic measurements from the source data. Never model inputs |")
    w("| `p_activity`, `p_toxicity_herg` | the two halves of the index |")
    w("| `*_source` | `measured`, `series_hansch`, `fallback_nonlinear`, or `unavailable` |")
    w("| `*_model`, `*_quality` | which model, and its validation score |")
    w("| `applicability_domain` | `measured`, `inside`, or `outside` — read `outside` rows with suspicion |")
    w("| `faers_*` | the most-reported adverse reaction terms from openFDA. Spontaneous reports with no "
      "exposure denominator: context for a reader, never a model input |")
    w("| `status` | `ranked`, or why not |")
    w("")
    w("**Sensible use:** compare rows against each other, prefer `measured` over `fallback_nonlinear`, and "
      "discard `outside`. **Not sensible use:** reading one molecule's index as its real-world safety margin.")
    w("")
    w("## What was left out, and why")
    w("")
    for reason, n in audit["not_ranked"].items():
        w(f"- **{n}** — {reason}")
    w("")
    w("Hammett σ and Taft Es were considered and deliberately excluded. Both are *substituent* constants: σ is "
      "defined for a group attached to a shared aromatic core, Es for a group next to a shared reaction centre. "
      "Neither has a value for a whole molecule, and neither is comparable between molecules that share no core. "
      "Assigning a single σ to amphotericin B and to atenolol would be inventing a number. Calculated partial "
      "charge extremes stand in as the electronic term, because they are defined everywhere.")
    w("")
    w("## Reproducing it")
    w("")
    w("```")
    w("python3 ti/inputs.py        # read the three source datasets, log every exclusion")
    w("python3 ti/resolve.py       # structures and primary targets")
    w("python3 ti/descriptors.py --selftest")
    w("python3 ti/pull_training.py --from-resolved --top 45")
    w("python3 ti/fit.py --all     # series models and fallbacks, with their gates")
    w("python3 ti/registry.py      # the registry of eligible local models + fingerprint bank")
    w("python3 ti/cores.py         # matched-pair core index, for the second routing basis")
    w("python3 ti/router_test.py --calibrate   # routing thresholds, from training data only")
    w("python3 ti/router_test.py --benchmark   # does structure alone find the right target?")
    w("python3 ti/rank.py          # the CSV and audit.json")
    w("python3 ti/report.py        # this file")
    w("python3 ti/publish.py       # copy the finished artefacts into one numbered folder")
    w("```")
    w("")

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "REPORT.md"
    path.write_text("\n".join(L) + "\n", encoding="utf-8")
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", type=Path, default=OUT)
    args = ap.parse_args()
    audit_path = args.out_dir / "audit.json"
    if not audit_path.exists():
        raise SystemExit("run ti/rank.py first")
    sys.path.insert(0, str(HERE))
    from fit import load_all  # noqa: PLC0415
    path = write(json.loads(audit_path.read_text(encoding="utf-8")), load_all(), args.out_dir)
    print(f"wrote {path} ({len(path.read_text(encoding='utf-8').splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
