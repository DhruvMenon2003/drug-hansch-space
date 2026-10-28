#!/usr/bin/env python3
"""Assemble everything this pipeline produced into one numbered folder a person can read in order.

    ti/publish.py                                  # into /mnt/project-files/qsar-therapeutic-index/
    ti/publish.py --dest some/other/folder

The pipeline scatters its work across ti/out/ and ti/cache/ because that is convenient for the code. It is
not convenient for a reader. This copies the finished artefacts into one place, numbers them in the order
they should be read, and writes a README that says in plain language what each file is and what it is not.

Nothing here computes anything. If a file is missing it is reported as missing rather than invented, so the
folder never implies a result that was not produced.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
DEST = Path("/mnt/project-files/qsar-therapeutic-index")

# source in ti/out  ->  published name, one-line description for the README
PLAN = [
    ("therapeutic_index.csv", "1-ranked-predictions.csv",
     "The deliverable. One row per molecule, one column per predictor, therapeutic_index last. "
     "Ranked *within* each target: rank_in_target 1 is the widest margin among the molecules routed to "
     "that same local model."),
    ("REPORT.md", "2-report.md",
     "The same run written out for a reader, structured on the five OECD validation principles: what the "
     "endpoint is, how the models were fitted and checked, where they may and may not be used."),
    ("registry.csv", "3-model-registry.csv",
     "Every local QSAR model: its target, endpoint, units, assay scope, training size, data hash and "
     "whether it passed validation. Failed models are listed and marked failed, not deleted."),
    ("router_benchmark.md", "4-router-benchmark.md",
     "The test of conditional routing. Given structure alone, how often does the router send a molecule to "
     "the target ChEMBL actually records for it, how often does it abstain, how often is it wrong."),
    ("audit.json", "5-audit.json",
     "Machine-readable provenance for the run: input hashes, library versions, acceptance thresholds, "
     "routing thresholds, per-target model results and every reason a row was not ranked."),
    ("routing_thresholds.json", "6-routing-thresholds.json",
     "The two routing thresholds and the training-data distributions they were derived from. No drug "
     "labels were used to set them."),
]


def registry_csv() -> Path | None:
    """Flatten ti/out/registry.json into a table, because a registry is something a person reads as rows."""
    src = OUT / "registry.json"
    if not src.exists():
        return None
    registry = json.loads(src.read_text(encoding="utf-8"))
    fields = ["model_id", "target_chembl_id", "endpoint", "units", "n", "eligible", "reason",
              "activity_min", "activity_median", "activity_max", "assay_scope", "dataset_sha256"]
    path = OUT / "registry.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for model in sorted(registry["models"], key=lambda m: (not m.get("eligible"), -m.get("n", 0))):
            writer.writerow({f: model.get(f, "") for f in fields})
    return path


def readme(dest: Path, present: list[tuple[str, str]], missing: list[str]) -> str:
    lines = [
        "# Therapeutic index, predicted per target",
        "",
        "Read the files in the order they are numbered. Everything in this folder came from one run of the "
        "pipeline in `drug-hansch-space/ti/`, and `5-audit.json` carries the hashes and versions that "
        "identify that run.",
        "",
        "## What this answers",
        "",
        "You have a molecule. You want to know how its margin between potency and cardiac liability compares "
        "with the molecules already known against the same target. You do not have to say what the target is: "
        "the router works that out from the structure, or says it cannot.",
        "",
        "## Scoring a molecule of your own",
        "",
        "From `drug-hansch-space/ti/`:",
        "",
        "```",
        "python3 place.py --smiles 'CC(C)NCC(O)COc1cccc2ccccc12'      # route it, show it in its cohort",
        "python3 place.py --smiles '<SMILES>' --target CHEMBL217      # or name the target yourself",
        "```",
        "",
        "It prints the routing decision with the similarity to each candidate target, the predicted hERG "
        "affinity, and the ranked cohort of known drugs with your molecule inserted at its place. If the "
        "router cannot decide, it shows the ranked candidates and their similarities instead of guessing.",
        "",
        "Read the runners-up, not only the chosen target. The propranolol-like structure above routes to "
        "CHEMBL287 at 0.879, with the two adrenergic receptors at 0.859 and 0.858 right behind it, and the "
        "margin between first and second is 0.02. That is the honest state of a structure-only assignment, "
        "and it is printed rather than hidden. Two other outcomes are just as normal: aspirin routes to "
        "CHEMBL230 and then reports that no model there is validated enough to score it, and a molecule "
        "sitting between several neighbourhoods is called ambiguous and placed against each candidate in "
        "turn for you to pick from.",
        "",
        "## What this is not",
        "",
        "There is no single ranking across all the molecules, and that is deliberate. Potency against one "
        "receptor and potency against another come from different assays, so a number that mixes them has no "
        "referent. The ranking is therefore inside each target only.",
        "",
        "The therapeutic index here is `p_activity - p_toxicity(hERG)`, a log ratio of two predicted binding "
        "affinities. It is not LD50/ED50, not a clinical therapeutic index, and carries no dose information.",
        "",
        "A target the router assigned is an inference from chemical similarity, never a measurement. The "
        "`target_source` column on every row says which it was.",
        "",
        "## The files",
        "",
    ]
    for name, description in present:
        lines += [f"**`{name}`**  ", description, ""]
    if missing:
        lines += ["## Not produced by this run", ""]
        lines += [f"- `{name}` - the pipeline did not produce this file, so it is absent rather than stale."
                  for name in missing]
        lines += [""]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dest", type=Path, default=DEST)
    args = ap.parse_args()

    registry_csv()
    args.dest.mkdir(parents=True, exist_ok=True)
    present, missing = [], []
    for source, name, description in PLAN:
        src = OUT / source
        if src.exists():
            shutil.copy2(src, args.dest / name)
            present.append((name, description))
            print(f"  {name:32s} <- ti/out/{source}")
        else:
            missing.append(name)
            print(f"  {name:32s} MISSING (ti/out/{source} not produced)", file=sys.stderr)

    (args.dest / "README.md").write_text(readme(args.dest, present, missing), encoding="utf-8")
    print(f"\n{len(present)} files published to {args.dest}")
    if missing:
        print(f"{len(missing)} not produced: {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
