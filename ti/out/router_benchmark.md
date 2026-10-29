# Does structure alone find the right target?

A chemist with a new molecule should not have to declare its target. So the router is given the structure and nothing else, and has to decide which of the local models that molecule is entitled to use. This file is the test of whether it can.

## How the test was set up

The molecules are drugs whose target ChEMBL records in its mechanism-of-action table, which gives a ground truth that was never shown to the router. Two things were done to keep the test honest:

- **Each drug's own training rows were hidden.** A router that recognises a molecule it was trained on has demonstrated nothing. With the drug's own rows removed, it has to reach the right model through its neighbours.
- **The thresholds were fixed before the test ran, from training data only.** They come from a leave-one-out comparison inside the training sets: how similar is a compound to its own target's chemistry, against the best other target's. No drug label was used to set them. Tuning them until the accuracy looked good would have made the accuracy a description of the tuning.

Scope floor **0.4536** (the 10th percentile of the own-target distribution, so nine in ten genuine members still clear it) and margin **0.01** (the 25th percentile of the lead a genuine member holds over the best rival target). A lead smaller than that reads as ambiguous rather than as an answer.

For scale: a compound's median similarity to its own target's chemistry is **0.7342**, and the median amount by which its own target beats the best rival is **0.2571**. In **27.7%** of cases some other target's chemistry was actually the closer match, which is the irreducible difficulty of the problem rather than a defect in the router.

## Results

| | A · Morgan fingerprint neighbours | B · shared-core matched pairs |
| --- | --- | --- |
| drugs with a known, modellable target | 592 | 592 |
| coverage (willing to route at all) | 61.5% | 45.8% |
| top-1 accuracy, of those routed | 70.3% | 72.0% |
| true target among the 3 best candidates | 68.6% | 51.2% |
| routed confidently to the wrong target | 108 | 76 |
| ambiguous (candidates shown, no prediction) | 54 | 47 |
| abstained (no model used) | 174 | 274 |
| baseline: always route to the largest model | 0.2% | 0.2% |

**The baseline is the bar to beat.** Always sending every molecule to the largest model requires no chemistry at all. If the router does not beat that, the conditional is decoration.

## What this means in practice

The better of the two neighbourhoods is **B · shared-core matched pairs**, at **72.0%** top-1 accuracy against a **0.2%** baseline: it clears the bar. Read the three numbers together rather than the accuracy alone - a router can buy accuracy by abstaining more, so coverage of **45.8%** is part of the same claim.

The honest reading of a routed row is: *this molecule's chemistry resembles the compounds measured against this target, closely enough and distinctly enough that this target's model is the one entitled to speak about it.* It is not a claim that the molecule binds that target. For that, run the assay.

An **ambiguous** result is useful in its own right: it says the molecule sits between two chemical neighbourhoods, and the candidates are in the row. An **abstain** says the molecule is unlike anything in the registry, which for a genuinely novel scaffold is the correct and most informative answer.

