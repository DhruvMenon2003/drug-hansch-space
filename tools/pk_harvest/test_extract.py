#!/usr/bin/env python3
"""Small regression suite for the extractor: uv run python tools/pk_harvest/test_extract.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import extract_block  # noqa: E402

CASES = [
    ("With the initial model, the mean lithium volume of distribution was 32.8 L and mean lithium clearance was 1.36 L/hr.",
     {("Vss", 0.469), ("CL", 0.324)}),
    ("The initial volume of distribution was 0.2 L/kg and the central volume 10 L.", set()),
    ("Patients received 500 mg twice daily; the serum concentration ranged between 5 and 10 µg/mL.",
     {("dose_ug", 500000.0), ("interval_min", 720.0)}),
    ("Multiple oral doses of 0.2mg moxonidine twice daily and 0.2mg digoxin once daily were administered.",
     {("dose_ug", 200.0), ("interval_min", 1440.0)}),
    ("The terminal volume of distribution of amitriptyline ranged between 2,381.4–3,958.4 L and clearance ranged between 51.5–97.5 L/h (Table 3).",
     {("Vss", 45.3), ("CL", 17.7)}),
    ("Parameter estimates were clearance CL 15.3 L.h-1.70 kg-1 (22.2%; 13.8-16.7) and central volume of distribution V1 33.5 L.70 kg-1.",
     {("CL", 3.64)}),
    ("Value of clearance (CL/F) was estimated to be 15 L/h, and volume of distribution (V/F) was 71.1 L for a typical patient weighing 40 kg.",
     {("CL", 6.25), ("Vss", 1.78)}),
    ("Plasma protein binding is about 30%.", {("fu", 0.7)}),
    ("The oral bioavailability is approximately 40% with marked patient-to-patient variations.", {("F", 0.4)}),
    ("Renal clearance was 120 mL/min and creatinine clearance 95 mL/min.", set()),
    ("The therapeutic range is 10-20 mg/L and toxicity occurs above 25 mg/L.",
     {("ther_min", 10.0), ("ther_max", 20.0), ("tox_min", 25.0)}),
    ("Simulated plasma profiles of haloperidol 0.5 mg every 12 h.", set()),
]

fails = 0
for text, expected in CASES:
    hits = extract_block({"kind": "abstract", "section": "Abstract", "text": text, "id": "b0"}, ["digoxin"])
    got = {(h["param"], h["value"]) for h in hits}
    ok = got == expected
    fails += 0 if ok else 1
    print(("PASS" if ok else "FAIL"), text[:70], "" if ok else f"\n      expected {sorted(expected)}\n      got      {sorted(got)}")
print(f"{len(CASES) - fails}/{len(CASES)} passed")
sys.exit(1 if fails else 0)
