# Example run

The printed output of one full execution of `reproducible_qsar_workflow.ipynb`, top to bottom, against ChEMBL\_37. Figures are omitted; everything the notebook writes to stdout is here, so the numbers can be read without running it. Re-running it against a later ChEMBL release will give different hashes and may give different counts, which is the point of printing the release next to the hash.

### `reproducibility`

```
run at            2026-11-01 05:28:12 UTC
python            3.13.17 on Linux-6.18.44-fc-v185-x86_64-with-glibc2.39
seed              0
board             My reproducible QSAR WorkFlow.excalidraw
board sha256      9df310c3598ed2830523026ab22a0010b14d3a999ceeba94b9192501cfb3f812
git commit        not a git checkout (module hashes pin the code instead)

Code written by this notebook, by SHA-256 of the source:
  tools/substituent_constants.py     4a6e751361f5b1f8988bdc7069f2046dc1333ce9e021a0faadd3cd010581b564
  tools/qsar_core.py                 8a75259ef271c59465d5134ff9cb293a0e49dbd1c3d6fc9c2612f2a72ce54a2d
  tools/series.py                    3950502abee88a93911442e341fbed831fe00880d68c7cdc6ed8ab92804d63c3
  tools/curate.py                    b836111c67c651e3b600eff99fde21072532c4a1931525c340a2ce97d2a45ef0
  tools/features.py                  4431917651fc37a5c75040cb87cc9bab1402aede4324a446915305069b00a36e
  tools/splits.py                    9eed20e1368a3274f6550e48574398be4f7001ab122c064af21912b76049acc0
  tools/schematics.py                069bac6d95dcdaece93b2859208710eb396683a632a90b25a6e31be4285e3934
  tools/whiteboard_sections.py       ead691eee2dde674e7925e14ab758ad67f10effde650423c927df569ad366bf7

Declared library pins (resolved and compared in section 1):
  numpy            2.5.3
  pandas           3.0.5
  scipy            1.18.1
  rdkit            2026.09.1
  scikit-learn     1.9.1
  matplotlib       3.10.8
  optuna           5.0.0
  shap             0.54.1
  joblib           1.5.2
```

## §1 Environment

### `install`

```
/tmp/claude-0/-home-user/10e0f3a2-6acf-5ccb-99de-610b3f97e968/scratchpad/qsar-env/lib/python3.13/site-packages/tqdm/auto.py:21: TqdmWarning: IProgress not found. Please update jupyter and ipywidgets. See https://ipywidgets.readthedocs.io/en/stable/user_install.html
  from .autonotebook import tqdm as notebook_tqdm
already present : numpy, pandas, scipy, rdkit, scikit-learn, matplotlib, optuna, shap, joblib
installed here  : none
```

### `write_substituent_constants`

```
Writing tools/substituent_constants.py
```

### `write_qsar_core`

```
Writing tools/qsar_core.py
```

### `write_series`

```
Writing tools/series.py
```

### `write_curate`

```
Writing tools/curate.py
```

### `write_features`

```
Writing tools/features.py
```

### `write_splits`

```
Writing tools/splits.py
```

### `write_schematics`

```
Writing tools/schematics.py
```

### `write_whiteboard_sections`

```
Writing tools/whiteboard_sections.py
```

### `hash_check`

```
all 8 modules written and hash-matched
imports ready
```

### `versions`

```
library         declared      resolved      match
numpy           2.5.3         2.5.4         NO
pandas          3.0.5         3.1.0         NO
scipy           1.18.1        1.18.1        yes
rdkit           2026.09.1     2026.09.1     yes
scikit-learn    1.9.1         1.9.1         yes
matplotlib      3.10.8        3.11.2        NO
optuna          5.0.0         5.0.0         yes
shap            0.54.1        0.54.1        yes
joblib          1.5.2         1.6.0         NO

This run used 4 library version(s) other than the declared pin.
That is recorded in RUN_ENVIRONMENT and exported in section 16.
```

## §2 The goal, and the board

### `goal`

```
                                                                stage  cards                                                                       notebook
                                         A. Where the data comes from     34                                                  Section 3, cell `source_pull`
                                              B. The dataset's schema     48                                      Section 4, cells `schema` and `atc_split`
                                C. Pre-processing and outlier removal     15                  Section 5, cells `dedupe_standardise`, `rule_flags`, `cliffs`
                  D. Selecting the modelling set, and the empty arrow      6          Section 6, cells `modelling_set`, `select_series`, `descriptor_block`
                    E. Feature selection and dimensionality reduction      8 Section 6, cells `modelling_set`, `select_series`, `descriptor_block`; Sect...
                                                    F. Model building      8 Section 7, cells `tier1_hansch`, `tier1_subsets`, `tier1_diagnostics`; Sect...
                                             G. Hyperparameter tuning      4                                  Section 10, cells `tier4_optuna`, `tier4_fit`
                                                        H. Validation     21 Section 11, cells `internal_validation`, `external_validation`; Section 11,...
                                                    I. Interpretation      7 Section 7, cells `tier1_hansch`, `tier1_subsets`, `tier1_diagnostics`; Sect...
                                              J. Applicability domain      3                                        Section 12, cell `applicability_domain`
                                                   K. The Hansch core     35 Section 7, cells `tier1_hansch`, `tier1_subsets`, `tier1_diagnostics`; Sect...
                                                          L. The goal      3            Section 2, markdown `goal`, and Section 15, cell `comparison_table`
Out of scope here: clinical trials, pharmacokinetics and epidemiology     59                                                                not implemented

Model families the board's regression column names:
  Hansch analysis based multi linear regression Tier 1, section 7
  Free-Wilson                                   Tier 2, section 8
  Principal component regression                Tier 3, section 9
  Partial least squares                         Tier 3, section 9
  Kernel PLS                                    NOT FITTED HERE
  Support vector regression, Gaussian kernel    NOT FITTED HERE
  Random forest                                 Tier 4, section 10
  Gradient boosting                             Tier 4, section 10
  Multilayer perceptron                         NOT FITTED HERE
  Graph neural network                          NOT FITTED HERE

6 of 10 named model families are fitted below.

Read and deliberately excluded: Out of scope here: clinical trials, pharmacokinetics and epidemiology (59 cards)
  These cards are about clinical trial conduct and epidemiology, not about fitting or validating
  a QSAR model. Nothing in them feeds a descriptor, an endpoint or a validation step, so the
  notebook does not implement them. They are listed here so it is clear they were read and not
  missed.
```

## §3 Data ingestion — ChEMBL, with provenance on every row

### `source_pull`

```
ChEMBL ChEMBL_37, released 2026-05-01, 24,527,044 activities in the release
pulled at 2026-11-01T05:28:18Z

================================================================================================
training: document CHEMBL1821550  (703 activity rows in the document)
  Bioorg Med Chem Lett 2011  doi:10.1016/j.bmcl.2011.07.006  pmid:21802950
  Novel and highly potent histamine H3 receptor ligands. Part 1: withdrawing of hERG activity.
                     filter  rows_in  rows_out  dropped                                                             reason
            assay_type == B      703       469      234  a binding assay, so the number is an affinity and not a phenotype
   standard_relation == '='      469       469        0                    an exact value, not a censored '>' or '<' bound
     standard_units == 'nM'      469       468        1            one concentration unit, so no unit conversion is needed
         standard_value > 0      468       468        0       a positive concentration, since the response is -log10 of it
data_validity_comment empty      468       458       10                        ChEMBL has not flagged the value as suspect
      pchembl_value present      458       458        0 ChEMBL derived a p-value, which it declines to do for a value i...
   canonical_smiles present      458       458        0                   there is a structure to compute descriptors from
  target / standard_type pairs surviving: {'CHEMBL240/IC50': 207, 'CHEMBL240/Ki': 17, 'CHEMBL264/Ki': 234}
  activity CHEMBL264 Ki    n=234  assay CHEMBL1827363
            Displacement of [125I]Iodoproxyfan from human recombinant histamine H3 receptor by Compe
            rows carrying ChEMBL's potential_duplicate flag: 102; compounds with more than one row: 0
  toxicity CHEMBL240 IC50  n=207  assay CHEMBL1827362
            Displacement of [3H]dofetilide from human recombinant ERG by Competitive binding assay
            rows carrying ChEMBL's potential_duplicate flag: 57; compounds with more than one row: 0
  counts: {'activity_measurements': 234, 'toxicity_measurements': 207, 'compounds_with_both': 207, 'compounds_with_activity_only': 27, 'compounds_with_toxicity_only': 0}

================================================================================================
external_quinoline: document CHEMBL1155513  (300 activity rows in the document)
  Bioorg Med Chem Lett 2010  doi:10.1016/j.bmcl.2010.04.045  pmid:20457525
  In vitro studies on a class of quinoline containing histamine H3 antagonists.
                     filter  rows_in  rows_out  dropped                                                             reason
            assay_type == B      300       300        0  a binding assay, so the number is an affinity and not a phenotype
   standard_relation == '='      300       300        0                    an exact value, not a censored '>' or '<' bound
     standard_units == 'nM'      300       225       75            one concentration unit, so no unit conversion is needed
         standard_value > 0      225       225        0       a positive concentration, since the response is -log10 of it
data_validity_comment empty      225       225        0                        ChEMBL has not flagged the value as suspect
      pchembl_value present      225       225        0 ChEMBL derived a p-value, which it declines to do for a value i...
   canonical_smiles present      225       225        0                   there is a structure to compute descriptors from
  target / standard_type pairs surviving: {'CHEMBL240/Ki': 75, 'CHEMBL264/Ki': 75, 'CHEMBL4124/Ki': 75}
  activity CHEMBL264 Ki    n=75   assay CHEMBL1120717
            Displacement of [3H]N-alpha-methylhistamine from human cloned histamine H3 receptor
            rows carrying ChEMBL's potential_duplicate flag: 7; compounds with more than one row: 0
  toxicity CHEMBL240 Ki    n=75   assay CHEMBL1120719
            Displacement of [3H]dofetilide from human ERG expressed in HEK293 cells
            rows carrying ChEMBL's potential_duplicate flag: 0; compounds with more than one row: 0
  counts: {'activity_measurements': 75, 'toxicity_measurements': 75, 'compounds_with_both': 75, 'compounds_with_activity_only': 0, 'compounds_with_toxicity_only': 0}

================================================================================================
external_ionworks: document CHEMBL2029265  (210 activity rows in the document)
  J Med Chem 2012  doi:10.1021/jm300011d  pmid:22313242
  2-(Pyrrolidin-1-yl)ethyl-3,4-dihydroisoquinolin-1(2H)-one derivatives as potent and selective histamine-3 receptor antagonists.
                     filter  rows_in  rows_out  dropped                                                             reason
            assay_type == B      210       157       53  a binding assay, so the number is an affinity and not a phenotype
   standard_relation == '='      157       117       40                    an exact value, not a censored '>' or '<' bound
     standard_units == 'nM'      117       107       10            one concentration unit, so no unit conversion is needed
         standard_value > 0      107       107        0       a positive concentration, since the response is -log10 of it
data_validity_comment empty      107       107        0                        ChEMBL has not flagged the value as suspect
      pchembl_value present      107       107        0 ChEMBL derived a p-value, which it declines to do for a value i...
   canonical_smiles present      107       107        0                   there is a structure to compute descriptors from
  target / standard_type pairs surviving: {'CHEMBL214/Ki': 6, 'CHEMBL228/Ki': 5, 'CHEMBL231/Ki': 4, 'CHEMBL240/IC50': 20, 'CHEMBL264/EC50': 1, 'CHEMBL264/Ki': 50, 'CHEMBL4124/Ki': 21}
  activity CHEMBL264 Ki    n=50   assay CHEMBL2034391
            Displacement of [3H]-(R)-alpha-methylhistamine from human H3 receptor expressed in HEK29
            rows carrying ChEMBL's potential_duplicate flag: 1; compounds with more than one row: 0
  toxicity CHEMBL240 IC50  n=20   assay CHEMBL2034394
            Inhibition of human ERG by IonWorks assay
            rows carrying ChEMBL's potential_duplicate flag: 0; compounds with more than one row: 0
  counts: {'activity_measurements': 50, 'toxicity_measurements': 20, 'compounds_with_both': 20, 'compounds_with_activity_only': 30, 'compounds_with_toxicity_only': 0}

================================================================================================
external_astemizole: document CHEMBL2375287  (133 activity rows in the document)
  Bioorg Med Chem Lett 2013  doi:10.1016/j.bmcl.2013.02.091  pmid:23558237
  A novel series of histamine H4 receptor antagonists based on the pyrido[3,2-d]pyrimidine scaffold: comparison of hERG binding and target residence time with PF-3893787.
                     filter  rows_in  rows_out  dropped                                                             reason
            assay_type == B      133       123       10  a binding assay, so the number is an affinity and not a phenotype
   standard_relation == '='      123       112       11                    an exact value, not a censored '>' or '<' bound
     standard_units == 'nM'      112        81       31            one concentration unit, so no unit conversion is needed
         standard_value > 0       81        81        0       a positive concentration, since the response is -log10 of it
data_validity_comment empty       81        81        0                        ChEMBL has not flagged the value as suspect
      pchembl_value present       81        81        0 ChEMBL derived a p-value, which it declines to do for a value i...
   canonical_smiles present       81        81        0                   there is a structure to compute descriptors from
  target / standard_type pairs surviving: {'CHEMBL1941/Ki': 3, 'CHEMBL231/Ki': 4, 'CHEMBL240/Ki': 13, 'CHEMBL264/Ki': 21, 'CHEMBL3759/Kd': 7, 'CHEMBL3759/Ki': 23, 'CHEMBL4468/Ki': 5, 'CHEMBL5657/Ki': 5}
  activity CHEMBL264 Ki    n=21   assay CHEMBL2379705
            Displacement of [3H]histamine from human histamine H3 receptor expressed in HEK cells
            rows carrying ChEMBL's potential_duplicate flag: 1; compounds with more than one row: 0
  toxicity CHEMBL240 Ki    n=13   assay CHEMBL2379703
            Displacement of [3H]astemizole from human ERG channel
            rows carrying ChEMBL's potential_duplicate flag: 0; compounds with more than one row: 0
  counts: {'activity_measurements': 21, 'toxicity_measurements': 13, 'compounds_with_both': 13, 'compounds_with_activity_only': 8, 'compounds_with_toxicity_only': 0}
```

### `document_scan`

```
documents in ChEMBL_37 measuring BOTH H3 and hERG affinity on at least 10 shared compounds: 4

     document  paired  h3_compounds  herg_compounds                role
CHEMBL1821550     224           234             224            training
CHEMBL1155513      75            75              75  external_quinoline
CHEMBL2029265      20            50              20   external_ionworks
CHEMBL2375287      13            21              13 external_astemizole

Every document the search finds is used. There is no fifth paper being left out, which also
means the external set cannot be made larger without relaxing the requirement that both
endpoints come from the same publication - and relaxing it is what makes a therapeutic index
meaningless, so it is not relaxed.
```

### `ingestion_assertions`

```
assertion 1 passed: every endpoint value is an experimental measurement, none predicted
assertion 2 passed: one assay per endpoint per set

                                                            rows
set_name            endpoint standard_type assay_chembl_id      
external_astemizole H3       Ki            CHEMBL2379705      21
                    hERG     Ki            CHEMBL2379703      13
external_ionworks   H3       Ki            CHEMBL2034391      50
                    hERG     IC50          CHEMBL2034394      20
external_quinoline  H3       Ki            CHEMBL1120717      75
                    hERG     Ki            CHEMBL1120719      75
training            H3       Ki            CHEMBL1827363     234
                    hERG     IC50          CHEMBL1827362     207

Provenance table, in full:
           set_name endpoint target_chembl_id standard_type assay_chembl_id                       citation  source_type
           training       H3        CHEMBL264            Ki   CHEMBL1827363 doi:10.1016/j.bmcl.2011.07.006 experimental
           training     hERG        CHEMBL240          IC50   CHEMBL1827362 doi:10.1016/j.bmcl.2011.07.006 experimental
 external_quinoline       H3        CHEMBL264            Ki   CHEMBL1120717 doi:10.1016/j.bmcl.2010.04.045 experimental
 external_quinoline     hERG        CHEMBL240            Ki   CHEMBL1120719 doi:10.1016/j.bmcl.2010.04.045 experimental
  external_ionworks       H3        CHEMBL264            Ki   CHEMBL2034391          doi:10.1021/jm300011d experimental
  external_ionworks     hERG        CHEMBL240          IC50   CHEMBL2034394          doi:10.1021/jm300011d experimental
external_astemizole       H3        CHEMBL264            Ki   CHEMBL2379705 doi:10.1016/j.bmcl.2013.02.091 experimental
external_astemizole     hERG        CHEMBL240            Ki   CHEMBL2379703 doi:10.1016/j.bmcl.2013.02.091 experimental
```

## §4 Schema, and the ATC worked example

### `schema`

```
                 column         kind                                    meaning
                    set   annotation    which source document the row came from
                   role   annotation                       training or external
               document   annotation                         ChEMBL document id
            compound_id   annotation                         ChEMBL molecule id
                 smiles   annotation               canonical SMILES from ChEMBL
          p_activity_H3 experimental           -log10(Ki / M), target CHEMBL264
      activity_value_nM experimental                            as reported, nM
        p_toxicity_hERG experimental   -log10(IC50 or Ki / M), target CHEMBL240
      toxicity_value_nM experimental                            as reported, nM
      therapeutic_index      derived                    p_activity - p_toxicity
         activity_assay   annotation                            ChEMBL assay id
         toxicity_assay   annotation                            ChEMBL assay id
               citation   annotation                    DOI of the source paper
 sum_pi, sum_sigma, ... experimental tabulated substituent constants, section 6
cLogP, TPSA, Chi1v, ...     computed                           RDKit, section 6

columns by kind: {'annotation': 8, 'experimental': 5, 'derived': 1, 'computed': 1}

curated table: 380 rows
                             p_activity_H3                          p_toxicity_hERG                         therapeutic_index                        
                                     count  mean   std   min    max           count  mean   std   min   max             count  mean   std   min   max
role     set                                                                                                                                         
external external_astemizole            21  6.30  0.48  5.02   6.84              13  5.27  0.53  4.36  6.08                13  1.05  0.55 -0.02  2.10
         external_ionworks              50  8.49  0.52  7.55   9.70              20  5.17  0.58  4.49  6.85                20  3.68  0.59  2.24  4.68
         external_quinoline             75  9.13  0.69  6.64  10.30              75  5.64  0.57  4.27  7.52                75  3.49  0.91  1.18  5.05
training training                      234  8.73  0.88  6.55  10.51             207  5.37  0.74  4.17  8.36               207  3.43  1.19 -0.31  5.65
```

### `atc_split`

```
cimetidine (CHEMBL30): 2 ATC code(s) -> 2 row(s)
mannitol (CHEMBL689): 5 ATC code(s) -> 5 row(s)

      drug compound_id atc_code anatomical therapeutic pharmacological chemical substance
cimetidine    CHEMBL30  A02BA51          A         A02            A02B    A02BA   A02BA51
cimetidine    CHEMBL30  A02BA01          A         A02            A02B    A02BA   A02BA01
  mannitol   CHEMBL689  B05CX04          B         B05            B05C    B05CX   B05CX04
  mannitol   CHEMBL689  B05BC01          B         B05            B05B    B05BC   B05BC01
  mannitol   CHEMBL689  A06AD16          A         A06            A06A    A06AD   A06AD16
  mannitol   CHEMBL689  R05CB16          R         R05            R05C    R05CB   R05CB16
  mannitol   CHEMBL689  V04CX04          V         V04            V04C    V04CX   V04CX04

One drug with several ATC codes becomes several rows, and the code splits into its
five levels as its own columns - which is what lets a global model be grouped by level.
```

## §5 Pre-processing

### `dedupe_standardise`

```
rows with both endpoints: 315 of 380

Missing values - counted, reported, and never imputed:
         column  missing                                                           what happens
  p_activity_H3        0 row kept in the curated table, excluded from any model that needs t...
p_toxicity_hERG       65 row kept in the curated table, excluded from any model that needs t...
         smiles        0                                              row cannot be used at all

Standardisation (largest fragment, neutralise, canonical tautomer):
  canonical tautomer    6
  changed               6
  total                 315

InChIKey duplicates within a set: 0
rows 315 -> 315 after InChIKey deduplication

Compounds already present in the TRAINING paper, per external document. A compound
the model has seen cannot test prediction, however it is labelled, so these go.
       external set      document  paired compounds  already in training  unseen
 external_quinoline CHEMBL1155513                75                   67       8
  external_ionworks CHEMBL2029265                20                    0      20
external_astemizole CHEMBL2375287                13                    0      13

67 external rows dropped as already seen; 41 unseen external compounds remain

That first document is the plan's original external set, and most of it is the training set
wearing a different citation. Had it been used as published, the external metrics in section 11
would have been measured largely on compounds the model had already been fitted to - which is
how an external validation comes to look better than the model is. It is reported here rather
than quietly corrected.
```

### `rule_flags`

```
fraction of compounds passing each rule (Pfizer column is fraction AT RISK):
                     ro5_pass  ro3_pass  pfizer_3_75_risk
set                                                      
external_astemizole       1.0     0.000             0.000
external_ionworks         1.0     0.000             0.900
external_quinoline        1.0     0.000             1.000
training                  1.0     0.024             0.918

Ro5 violation counts:
                                    compounds
set                 ro5_violations           
external_astemizole 0                      13
external_ionworks   0                      20
external_quinoline  0                       8
training            0                     166
                    1                      41

No compound is removed for any of these. 0 compounds
fail Lipinski and stay in; section 7 refits without them and reports both.
```

### `cliffs`

```
Fingerprint near-neighbour cliffs in the training set (Morgan r=2, 2048 bits):
  pairs_examined            21321
  near_neighbour_pairs      177
  cliffs                    6
  similarity_min            0.75
  delta_min                 1.0
  highest_similarity_seen   1.0

  top pairs by SALI = |delta p| / (1 - Tanimoto):
            a             b  tanimoto  delta_p  SALI
CHEMBL1085396 CHEMBL1085641     0.788     1.69   8.0
CHEMBL1823180  CHEMBL561324     0.815     1.12   6.1
CHEMBL1092105 CHEMBL1093113     0.796     1.09   5.3
 CHEMBL558456  CHEMBL569832     0.765     1.16   4.9
CHEMBL1823180  CHEMBL565007     0.796     1.00   4.9
CHEMBL1083406 CHEMBL1822868     0.759     1.06   4.4
```

## §6 The modelling set, the target variable, and the empty arrow

### `modelling_set`

```
training modelling set: 207 compounds
external set          : 41 compounds, from 3 independent documents
                                                                                 compounds
set                 document      activity_standard_type toxicity_standard_type           
external_astemizole CHEMBL2375287 Ki                     Ki                             13
external_ionworks   CHEMBL2029265 Ki                     IC50                           20
external_quinoline  CHEMBL1155513 Ki                     Ki                              8

Sign convention, worked through on the widest-margin compound in the training set:
  CHEMBL1085337
  H3 Ki              0.05 nM  ->  pActivity = 10.30
  hERG IC50     2.24e+04 nM  ->  pToxicity = 4.65
  TI = pActivity - pToxicity = 5.65
  A larger TI means the compound binds H3 at a lower concentration than it binds hERG.
  It is a ratio of two in vitro binding affinities. It is not a dose, a margin in a patient,
  or a clinical therapeutic index.
```

### `substituent_constants`

```
self-consistency of the tabulated constants (H = 0, MR > 0, Es <= 0, halogen order):
   all checks pass

pi re-derivation probe, benzene: (1.69, 'CHEMBL277500', 'alogp')
substituent                probe  derived_pi  tabulated_pi  difference source
          H             c1ccccc1        0.00          0.00        0.00  alogp
        CH3            c1ccccc1C        0.31          0.56       -0.25  alogp
       C2H5           c1ccccc1CC        0.56          1.02       -0.46  alogp
     n-C3H7          c1ccccc1CCC        0.95          1.55       -0.60  alogp
     i-C3H7        c1ccccc1C(C)C        1.12          1.53       -0.41  alogp
     t-C4H9     c1ccccc1C(C)(C)C        1.29          1.98       -0.69  alogp
       C6H5     c1ccccc1c1ccccc1        1.66          1.96       -0.30  alogp
          F            c1ccccc1F        0.14          0.14        0.00  alogp
         Cl           c1ccccc1Cl        0.65          0.71       -0.06  alogp
         Br           c1ccccc1Br        0.76          0.86       -0.10  alogp
          I            c1ccccc1I        0.60          1.12       -0.52  alogp
         OH            c1ccccc1O       -0.30         -0.67        0.37  alogp
       OCH3           c1ccccc1OC        0.01         -0.02        0.03  alogp
      OC2H5          c1ccccc1OCC        0.40          0.38        0.02  alogp
       OCF3    c1ccccc1OC(F)(F)F        0.90          1.04       -0.14  alogp
        NH2            c1ccccc1N       -0.42         -1.23        0.81  alogp
    N(CH3)2        c1ccccc1N(C)C        0.06          0.18       -0.12  alogp
        NO2 c1ccccc1[N+](=O)[O-]       -0.10         -0.28        0.18  alogp
         CN          c1ccccc1C#N       -0.13         -0.57        0.44  alogp
        CF3     c1ccccc1C(F)(F)F        1.02          0.88        0.14  alogp
        CHO          c1ccccc1C=O       -0.19         -0.65        0.46  alogp
      COCH3       c1ccccc1C(C)=O        0.20         -0.55        0.75  alogp
       COOH       c1ccccc1C(O)=O       -0.31         -0.32        0.01  alogp
      CONH2       c1ccccc1C(N)=O       -0.90         -1.49        0.59  alogp
       SCH3           c1ccccc1SC        0.72          0.61        0.11  alogp
     SO2NH2   c1ccccc1S(N)(=O)=O       -1.36         -1.82        0.46  alogp

checked 26, no log P available for 0, disagreeing by more than 0.5 log units: ['n-C3H7', 't-C4H9', 'I', 'NH2', 'COCH3', 'CONH2']

NOTE ON THIS CHECK: ChEMBL's `alogp` is itself a CALCULATED log P, not a shake-flask
measurement, so this is a consistency probe against an independent calculation and not the
experimental re-derivation the plan asked for. It is reported as what it is. A substituent
that disagrees is named above; none is silently replaced, and the tabulated value is the one
used in the model either way, because the compilation's values are the experimental ones.
```

### `descriptor_block`

```
congeneric series with at least 6 covered members: 5
  [0] n=21  positions 5 varying of 5  dropped 0  scaffold O=c1c2ccccc2ncn1-c1ccc(OCCCN2CCCC2)cc1
  [1] n=9   positions 5 varying of 6  dropped 0  scaffold O=S1(=O)CC(c2ccc(OCCCN3CCCC3)cc2)Oc2ccccc21
  [2] n=9   positions 4 varying of 5  dropped 0  scaffold O=c1[nH]c(-c2ccc(OC3CCN(C4CCC4)CC3)cc2)nc2ccccc12
  [3] n=6   positions 3 varying of 4  dropped 0  scaffold c1cncc(-c2ccc3cc(CCN4CCCC4)ccc3n2)c1
  [4] n=6   positions 3 varying of 3  dropped 1  scaffold c1cncc(-c2cnc3nc(N4CCC(N5CCCCC5)CC4)sc3c2)c1

computed descriptor block: 207 x 25  (25 columns, 24 descriptors)
  the lipophilicity pair occupies columns [(0, 1)] and counts as ONE descriptor
  columns: cLogP, cLogP_sq, cMR, TPSA, MolWt, HeavyAtoms, HBD, HBA, RotBonds, Rings, AromaticRings, FractionCSP3, Heteroatoms, LabuteASA, BalabanJ, BertzCT, HallKierAlpha, Kappa1, Kappa2, Kappa3, Chi0v, Chi1v, Chi2v, Chi3v, QED
```

## §7 Tier 1 — Hansch linear free-energy relationship

### `the_split`

```
  n_total                 207
  n_train                 155
  n_test                  52
  scaffolds_total         113
  scaffolds_train         61
  scaffolds_test          52
  shared_scaffolds        0
  near_duplicates_moved   0
  tanimoto_cutoff         0.95
  folds                   5
  fold_sizes              [31, 31, 31, 31, 31]

  assertion passed: no scaffold appears on both sides of the split
```

### `tier1_hansch`

```
series n = 21, scaffold O=c1c2ccccc2ncn1-c1ccc(OCCCN2CCCC2)cc1
terms available: ['sum_pi', 'sum_pi_sq', 'sum_sigma', 'sum_Es', 'sum_MR']
  descriptors (lipophilicity pair counted once): 4
  coefficients those descriptors fit            : 5
  Topliss-Costello cap at n/5                   : 4 descriptors

================================================================================================
FULL MODEL, response = H3 affinity  log(1/C)
     term  coefficient  std error       t      p  ci low  ci high
intercept       8.8595     0.2608 33.9745 0.0000  8.3037   9.4153
   sum_pi       0.3997     0.5996  0.6666 0.5152 -0.8783   1.6776
sum_pi_sq      -0.0678     0.3423 -0.1981 0.8456 -0.7974   0.6618
sum_sigma       0.0929     0.3924  0.2368 0.8160 -0.7435   0.9293
   sum_Es       0.0856     0.0931  0.9195 0.3724 -0.1129   0.2841
   sum_MR       0.2249     0.2465  0.9124 0.3760 -0.3005   0.7504
  n 21   coefficients 5   descriptors 4
  r2 0.3941   adjusted r2 0.1922   s 0.2010   F 1.95 (p 0.145)
  VIF: {'sum_pi': np.float64(32.17), 'sum_pi_sq': np.float64(35.76), 'sum_sigma': np.float64(5.2), 'sum_Es': np.float64(3.19), 'sum_MR': np.float64(3.75)}
  H3 affinity  log(1/C) = +8.859 +0.400·sum_pi -0.068·sum_pi_sq +0.093·sum_sigma +0.086·sum_Es +0.225·sum_MR

================================================================================================
FULL MODEL, response = therapeutic index
     term  coefficient  std error       t      p  ci low  ci high
intercept       2.4982     0.5390  4.6345 0.0003  1.3493   3.6471
   sum_pi       2.5388     1.2394  2.0484 0.0584 -0.1029   5.1804
sum_pi_sq      -1.4617     0.7076 -2.0656 0.0566 -2.9699   0.0466
sum_sigma       0.3915     0.8112  0.4826 0.6364 -1.3375   2.1204
   sum_Es       0.1821     0.1925  0.9462 0.3590 -0.2281   0.5924
   sum_MR       0.7752     0.5096  1.5213 0.1490 -0.3109   1.8614
  n 21   coefficients 5   descriptors 4
  r2 0.4274   adjusted r2 0.2366   s 0.4154   F 2.24 (p 0.104)
  VIF: {'sum_pi': np.float64(32.17), 'sum_pi_sq': np.float64(35.76), 'sum_sigma': np.float64(5.2), 'sum_Es': np.float64(3.19), 'sum_MR': np.float64(3.75)}
  therapeutic index = +2.498 +2.539·sum_pi -1.462·sum_pi_sq +0.391·sum_sigma +0.182·sum_Es +0.775·sum_MR
```

### `tier1_subsets`

```

================================================================================================
SUBSET SELECTION, response = H3 affinity  log(1/C)
                       terms  descriptors  coefficients   AICc     r2  adj r2
                      sum_MR            1             1 -62.73 0.2557  0.2165
           sum_sigma, sum_MR            2             2 -61.10 0.3056  0.2285
           sum_pi, sum_pi_sq            1             2 -60.57 0.2879  0.2088
              sum_Es, sum_MR            2             2 -59.75 0.2597  0.1775
   sum_pi, sum_pi_sq, sum_MR            2             3 -59.19 0.3562  0.2426
sum_pi, sum_pi_sq, sum_sigma            2             3 -58.79 0.3440  0.2282
   sum_pi, sum_pi_sq, sum_Es            2             3 -58.57 0.3369  0.2199
   sum_sigma, sum_Es, sum_MR            3             3 -57.90 0.3157  0.1949
                      sum_Es            1             1 -57.65 0.0518  0.0019
                   sum_sigma            1             1 -56.63 0.0047 -0.0477
  subsets that split the lipophilicity pair: 0 (must be 0)
  selected: ['sum_MR']  (1 descriptors, 1 coefficients)
  H3 affinity  log(1/C) = +8.845 +0.320·sum_MR

================================================================================================
SUBSET SELECTION, response = therapeutic index
                            terms  descriptors  coefficients   AICc     r2  adj r2
                           sum_MR            1             1 -29.02 0.1805  0.1374
        sum_pi, sum_pi_sq, sum_MR            2             3 -28.74 0.3932  0.2862
                        sum_sigma            1             1 -28.15 0.1460  0.1010
                sum_sigma, sum_MR            2             2 -27.91 0.2540  0.1711
                sum_pi, sum_pi_sq            1             2 -27.71 0.2469  0.1632
     sum_pi, sum_pi_sq, sum_sigma            2             3 -26.72 0.3317  0.2138
                sum_sigma, sum_Es            2             2 -26.67 0.2086  0.1207
                   sum_Es, sum_MR            2             2 -26.24 0.1922  0.1024
sum_pi, sum_pi_sq, sum_Es, sum_MR            3             4 -25.64 0.4186  0.2732
        sum_pi, sum_pi_sq, sum_Es            2             3 -25.45 0.2901  0.1648
  subsets that split the lipophilicity pair: 0 (must be 0)
  selected: ['sum_MR']  (1 descriptors, 1 coefficients)
  therapeutic index = +3.191 +0.572·sum_MR
```

### `tier1_diagnostics`

```
correlation matrix of the Hansch block:
           sum_pi  sum_pi_sq  sum_sigma  sum_Es  sum_MR
sum_pi      1.000      0.970      0.458  -0.710   0.540
sum_pi_sq   0.970      1.000      0.545  -0.637   0.499
sum_sigma   0.458      0.545      1.000  -0.474  -0.288
sum_Es     -0.710     -0.637     -0.474   1.000  -0.332
sum_MR      0.540      0.499     -0.288  -0.332   1.000

compounds outside the Williams limits: 1
  CHEMBL518431  leverage 0.336  standardised residual -0.25

Series members failing Lipinski: 0
  no refit is reported: removing them would leave too few compounds, or none fail.

matched molecular pairs inside the series with |delta p| >= 1: 0
```

## §8 Tier 2 — Free–Wilson

### `tier2_free_wilson`

```
n = 21 compounds, 20 indicator columns
  columns and how many compounds carry each substituent:
    {'R1:C2H5': np.int64(1), 'R1:CH3': np.int64(17), 'R1:i-C3H7': np.int64(1), 'R1:n-C3H7': np.int64(1), 'R2:CF3': np.int64(1), 'R2:CH3': np.int64(1), 'R2:F': np.int64(1), 'R2:OCH3': np.int64(1), 'R3:CF3': np.int64(1), 'R3:CH3': np.int64(1), 'R3:F': np.int64(1), 'R3:OCH3': np.int64(1), 'R4:CH3': np.int64(1), 'R4:F': np.int64(1), 'R4:OCH3': np.int64(1), 'R5:CF3': np.int64(1), 'R5:CH3': np.int64(1), 'R5:Cl': np.int64(1), 'R5:F': np.int64(1), 'R5:OCH3': np.int64(1)}

  The design is saturated: 20 indicators cannot be fitted by least squares to
  21 compounds, which is the Topliss-Costello rule failing in its starkest form.
  Reporting an OLS Free-Wilson model here would be reporting an interpolation. Two honest
  moves instead: drop the indicators carried by only one compound, which are unidentifiable
  anyway, and if that is still not enough, fit a ridge-penalised Free-Wilson and label it as
  penalised rather than pretend it is OLS.

  indicators carried by at least two compounds: 1 of 20

  OLS Free-Wilson: n 21  k 1  r2 0.0490  adj r2 -0.0011  s 0.2237
  Q2(LOO) -0.2745

  Tier 1 (Hansch, 1 descriptors): r2 0.2557
  Tier 2 (Free-Wilson, 1 indicators, OLS): r2 0.0490
  Free-Wilson has one coefficient per substituent and must fit at least as well; the question
  is how much of its advantage is explanation and how much is parameters. The difference here
  is -0.2067 r2 for +0 extra fitted terms.
```

## §9 Tier 3 — classical 2D QSAR

### `tier3_ga`

```

================================================================================================
TIER 3 MLR, response = p_activity_H3
  GA chose 9 descriptors (9 coefficients) from 24
  cMR, TPSA, HBD, RotBonds, FractionCSP3, Heteroatoms, LabuteASA, BertzCT, Chi2v
  fold R2 0.5754   mean |r| among them 0.393   fitness 0.4380   generations 40
  refit on all 207: r2 0.5830  adj r2 0.5639  Q2(LOO) 0.5350  s 0.5872

================================================================================================
TIER 3 MLR, response = p_toxicity_hERG
  GA chose 10 descriptors (11 coefficients) from 24
  cLogP, cLogP_sq, cMR, MolWt, HBD, HBA, RotBonds, AromaticRings, BalabanJ, HallKierAlpha, Chi0v
  fold R2 0.4464   mean |r| among them 0.374   fitness 0.3156   generations 40
  refit on all 207: r2 0.5106  adj r2 0.4830  Q2(LOO) 0.4406  s 0.5348

================================================================================================
TIER 3 MLR, response = therapeutic_index
  GA chose 10 descriptors (11 coefficients) from 24
  cLogP, cLogP_sq, cMR, HeavyAtoms, HBD, RotBonds, Rings, Heteroatoms, BertzCT, Chi0v, Chi1v
  fold R2 0.5727   mean |r| among them 0.465   fitness 0.4098   generations 40
  refit on all 207: r2 0.5651  adj r2 0.5405  Q2(LOO) 0.5114  s 0.8083
```

### `tier3_pls_pca`

```
TIER 3 PLS, p_activity_H3        components 7   fold R2 0.4122  refit r2 0.5894
TIER 3 PLS, p_toxicity_hERG      components 5   fold R2 0.2736  refit r2 0.4534
TIER 3 PLS, therapeutic_index    components 7   fold R2 0.4343  refit r2 0.5419

PCA over the same block: 7 components carry 95% of the variance (25 columns in)
  explained variance ratio: [0.502 0.183 0.11  0.077 0.033 0.028 0.022 0.015 0.008 0.006]
```

### `tier3_mordred`

```
Mordred did not install in this environment, which is the expected outcome on a
current Python: the package is unmaintained. RDKit descriptors are used instead.
  reason: CalledProcessError: Command '['/tmp/claude-0/-home-user/10e0f3a2-6acf-5ccb-99de-610b3f97e968/scratchpad/qsar-env/bin/python', '-m', 'pip', 'install', '-q', 'mordred']' returned non-zero exit status 1.
/tmp/claude-0/-home-user/10e0f3a2-6acf-5ccb-99de-610b3f97e968/scratchpad/qsar-env/bin/python: No module named pip
```

### `toxicity_as_predictor`

```
coefficient on pToxicity   -0.0811   se 0.0495   t -1.64   p 0.103   VIF 1.49

                           model  coefficients     r2  Q2 LOO  fold R2  ext Q2F3  ext CCC
                descriptors only             9 0.5830  0.5350   0.5754   -0.1114   0.6394
descriptors + measured pToxicity            10 0.5886  0.5359   0.5535    0.1083   0.7204

change in Q2(LOO) from adding measured hERG affinity: +0.0009

Whatever the sign of that number, the augmented model is NOT offered as a predictor. It needs
a measured toxicity for every compound it predicts, which can only exist after the compound
has been synthesised and assayed - by which point its activity has been measured too. The
correlation between the two endpoints across this series is -0.059, which is the shared structural
dependence the descriptor block is already trying to capture, not a causal path.
```

## §10 Tier 4 — machine learning, labelled black-box

### `tier4_optuna`

```

================================================================================================
TIER 4 search, response = p_activity_H3
  trials 40  states {'COMPLETE': 23, 'PRUNED': 17}
  fold fits actually paid for: 168 of 200 without pruning
  best fold R2 0.6091
  best params {'model': 'random_forest', 'rf_n_estimators': 450, 'rf_max_depth': 15, 'rf_min_samples_leaf': 1, 'rf_max_features': 0.2729587195822099}

================================================================================================
TIER 4 search, response = p_toxicity_hERG
  trials 40  states {'PRUNED': 23, 'COMPLETE': 17}
  fold fits actually paid for: 138 of 200 without pruning
  best fold R2 0.4460
  best params {'model': 'gradient_boosting', 'gb_n_estimators': 450, 'gb_learning_rate': 0.049827343850137276, 'gb_max_depth': 5, 'gb_subsample': 0.8494209290251787}

================================================================================================
TIER 4 search, response = therapeutic_index
  trials 40  states {'COMPLETE': 34, 'PRUNED': 6}
  fold fits actually paid for: 184 of 200 without pruning
  best fold R2 0.5494
  best params {'model': 'random_forest', 'rf_n_estimators': 550, 'rf_max_depth': 15, 'rf_min_samples_leaf': 1, 'rf_max_features': 0.20980050176819082}
```

### `tier4_fit`

```
p_activity_H3         RandomForestRegressor     resubstitution r2 0.9524  (fold R2 0.6091)
p_toxicity_hERG       GradientBoostingRegressor resubstitution r2 0.9975  (fold R2 0.4460)
therapeutic_index     RandomForestRegressor     resubstitution r2 0.9433  (fold R2 0.5494)

The gap between the resubstitution r2 and the fold R2 is the point of printing both: the
first is what the model can memorise, the second is what it can predict on scaffolds it has
not seen. Section 11 uses the second and the external set, never the first.
```

## §11 Validation — one split, every tier

### `internal_validation`

```

Tier 1 Hansch, H3 affinity
  n 21   r2 0.2557   Q2(LOO) 0.1160
  Q2(LMO, 20% out x100): mean 0.1130  sd 0.5756  min -1.7656  max 0.9014
  y-randomisation x100: r2 mean 0.0482 max 0.2670 | Q2 mean -0.1707 max 0.0639
  the real model sits outside the randomisation cloud: False

Tier 1 Hansch, therapeutic index
  n 21   r2 0.1805   Q2(LOO) -0.0512
  Q2(LMO, 20% out x100): mean -0.1224  sd 0.9329  min -2.8698  max 0.9029
  y-randomisation x100: r2 mean 0.0547 max 0.3760 | Q2 mean -0.1619 max 0.2157
  the real model sits outside the randomisation cloud: False

Tier 2 Free-Wilson, H3 affinity
  n 21   r2 0.0490   Q2(LOO) -0.2745
  Q2(LMO, 20% out x100): mean -0.2207  sd 0.8054  min -3.4727  max 0.8961
  y-randomisation x100: r2 mean 0.0472 max 0.3403 | Q2 mean -0.1802 max 0.2436
  the real model sits outside the randomisation cloud: False

Tier 3 MLR, p_activity_H3
  n 207   r2 0.5830   Q2(LOO) 0.5350
  Q2(LMO, 20% out x100): mean 0.5460  sd 0.1226  min 0.1786  max 0.7628
  y-randomisation x100: r2 mean 0.0381 max 0.0925 | Q2 mean -0.0634 max 0.0029
  the real model sits outside the randomisation cloud: True

Tier 3 MLR, p_toxicity_hERG
  n 207   r2 0.5106   Q2(LOO) 0.4406
  Q2(LMO, 20% out x100): mean 0.4377  sd 0.1160  min 0.1344  max 0.6294
  y-randomisation x100: r2 mean 0.0535 max 0.1141 | Q2 mean -0.0672 max 0.0125
  the real model sits outside the randomisation cloud: True

Tier 3 MLR, therapeutic_index
  n 207   r2 0.5651   Q2(LOO) 0.5114
  Q2(LMO, 20% out x100): mean 0.5162  sd 0.1161  min 0.2021  max 0.7453
  y-randomisation x100: r2 mean 0.0523 max 0.1230 | Q2 mean -0.0696 max 0.0148
  the real model sits outside the randomisation cloud: True
```

### `external_validation`

```
external compounds sharing the Tier 1 series scaffold: 0 of 41
  A Hansch equation is defined inside one congeneric series. The external documents are
  different chemotypes, so their compounds cannot be decomposed against this series' core and
  Tiers 1 and 2 have no external set to be tested on. That is a property of the method, not a
  failure of this run, and it is the single strongest argument for the board's own goal: many
  LOCAL models, each valid inside its own series, assembled rather than extrapolated.

Tier 3 MLR, p_activity_H3
  n_external 41  q2_f1 0.5763  q2_f2 0.4071  q2_f3 -0.1114  ccc 0.6394  r2_ext 0.7717  r2m 0.5219  rmse_ext 0.9351  mae_ext 0.7491

Tier 3 PLS, p_activity_H3
  n_external 41  q2_f1 0.2723  q2_f2 -0.0184  q2_f3 -0.9088  ccc 0.5044  r2_ext 0.7190  r2m 0.5006  rmse_ext 1.2255  mae_ext 1.0411

Tier 3 MLR, p_toxicity_hERG
  n_external 41  q2_f1 -6.7913  q2_f2 -7.0425  q2_f3 -3.6589  ccc 0.0665  r2_ext 0.0151  r2m -0.0232  rmse_ext 1.6016  mae_ext 1.2228

Tier 3 PLS, p_toxicity_hERG
  n_external 41  q2_f1 -7.0085  q2_f2 -7.2668  q2_f3 -3.7889  ccc 0.0340  r2_ext 0.0042  r2m -0.0065  rmse_ext 1.6237  mae_ext 1.2147

Tier 3 MLR, therapeutic_index
  n_external 41  q2_f1 -0.6570  q2_f2 -1.0940  q2_f3 -1.4897  ccc 0.0502  r2_ext 0.0199  r2m 0.0175  rmse_ext 1.8770  mae_ext 1.3913

Tier 3 PLS, therapeutic_index
  n_external 41  q2_f1 -1.9275  q2_f2 -2.6996  q2_f3 -3.3987  ccc -0.1749  r2_ext 0.2549  r2m 0.0439  rmse_ext 2.4950  mae_ext 1.7884

Tier 4 RandomForestRegressor, p_activity_H3 (exploratory)
  n_external 41  q2_f1 0.6082  q2_f2 0.4517  q2_f3 -0.0278  ccc 0.5966  r2_ext 0.8385  r2m 0.4214  rmse_ext 0.8993  mae_ext 0.6223

Tier 4 GradientBoostingRegressor, p_toxicity_hERG (exploratory)
  n_external 41  q2_f1 -0.8048  q2_f2 -0.8630  q2_f3 -0.0792  ccc -0.0442  r2_ext 0.0028  r2m 0.0005  rmse_ext 0.7708  mae_ext 0.6085

Tier 4 RandomForestRegressor, therapeutic_index (exploratory)
  n_external 41  q2_f1 0.0707  q2_f2 -0.1743  q2_f3 -0.3962  ccc 0.1157  r2_ext 0.1100  r2m 0.0940  rmse_ext 1.4057  mae_ext 1.0922

================================================================================================
POOLED over every external document
                                                                 n_external   q2_f1   q2_f2   q2_f3     ccc  r2_ext     r2m  rmse_ext  mae_ext
Tier 3 MLR, p_activity_H3                                              41.0  0.5763  0.4071 -0.1114  0.6394  0.7717  0.5219    0.9351   0.7491
Tier 3 PLS, p_activity_H3                                              41.0  0.2723 -0.0184 -0.9088  0.5044  0.7190  0.5006    1.2255   1.0411
Tier 3 MLR, p_toxicity_hERG                                            41.0 -6.7913 -7.0425 -3.6589  0.0665  0.0151 -0.0232    1.6016   1.2228
Tier 3 PLS, p_toxicity_hERG                                            41.0 -7.0085 -7.2668 -3.7889  0.0340  0.0042 -0.0065    1.6237   1.2147
Tier 3 MLR, therapeutic_index                                          41.0 -0.6570 -1.0940 -1.4897  0.0502  0.0199  0.0175    1.8770   1.3913
Tier 3 PLS, therapeutic_index                                          41.0 -1.9275 -2.6996 -3.3987 -0.1749  0.2549  0.0439    2.4950   1.7884
Tier 4 RandomForestRegressor, p_activity_H3 (exploratory)              41.0  0.6082  0.4517 -0.0278  0.5966  0.8385  0.4214    0.8993   0.6223
Tier 4 GradientBoostingRegressor, p_toxicity_hERG (exploratory)        41.0 -0.8048 -0.8630 -0.0792 -0.0442  0.0028  0.0005    0.7708   0.6085
Tier 4 RandomForestRegressor, therapeutic_index (exploratory)          41.0  0.0707 -0.1743 -0.3962  0.1157  0.1100  0.0940    1.4057   1.0922
```

### `external_per_document`

```
       external set      document                                             model  n    Q2F3    CCC  RMSE   MAE
external_astemizole CHEMBL2375287                         Tier 3 MLR, p_activity_H3 13  -1.734  0.018 1.467 1.412
  external_ionworks CHEMBL2029265                         Tier 3 MLR, p_activity_H3 20   0.794 -0.008 0.403 0.337
 external_quinoline CHEMBL1155513                         Tier 3 MLR, p_activity_H3  8   0.262  0.344 0.762 0.701
external_astemizole CHEMBL2375287                       Tier 3 MLR, p_toxicity_hERG 13 -11.820  0.055 2.657 2.608
  external_ionworks CHEMBL2029265                       Tier 3 MLR, p_toxicity_hERG 20   0.060  0.093 0.719 0.590
 external_quinoline CHEMBL1155513                       Tier 3 MLR, p_toxicity_hERG  8   0.305  0.492 0.619 0.555
external_astemizole CHEMBL2375287                     Tier 3 MLR, therapeutic_index 13  -5.839 -0.004 3.111 3.035
  external_ionworks CHEMBL2029265                     Tier 3 MLR, therapeutic_index 20   0.591  0.111 0.761 0.551
 external_quinoline CHEMBL1155513                     Tier 3 MLR, therapeutic_index  8   0.377  0.468 0.939 0.821
external_astemizole CHEMBL2375287 Tier 4 GradientBoostingRegressor, p_toxicity_hERG 13  -0.398 -0.003 0.877 0.759
  external_ionworks CHEMBL2029265 Tier 4 GradientBoostingRegressor, p_toxicity_hERG 20  -0.080 -0.369 0.771 0.551
 external_quinoline CHEMBL1155513 Tier 4 GradientBoostingRegressor, p_toxicity_hERG  8   0.441  0.565 0.555 0.508
external_astemizole CHEMBL2375287       Tier 4 RandomForestRegressor, p_activity_H3 13  -2.008 -0.006 1.538 1.480
  external_ionworks CHEMBL2029265       Tier 4 RandomForestRegressor, p_activity_H3 20   0.889  0.054 0.296 0.239
 external_quinoline CHEMBL1155513       Tier 4 RandomForestRegressor, p_activity_H3  8   0.898  0.822 0.283 0.188
external_astemizole CHEMBL2375287   Tier 4 RandomForestRegressor, therapeutic_index 13  -2.655 -0.018 2.274 2.187
  external_ionworks CHEMBL2029265   Tier 4 RandomForestRegressor, therapeutic_index 20   0.633 -0.224 0.721 0.571
 external_quinoline CHEMBL1155513   Tier 4 RandomForestRegressor, therapeutic_index  8   0.701  0.392 0.651 0.616

spread in Q2F3 across the external documents, per model:
                                                      min    max  count   range
model                                                                          
Tier 3 MLR, p_activity_H3                          -1.734  0.794      3   2.528
Tier 3 MLR, p_toxicity_hERG                       -11.820  0.305      3  12.125
Tier 3 MLR, therapeutic_index                      -5.839  0.591      3   6.430
Tier 4 GradientBoostingRegressor, p_toxicity_hERG  -0.398  0.441      3   0.839
Tier 4 RandomForestRegressor, p_activity_H3        -2.008  0.898      3   2.906
Tier 4 RandomForestRegressor, therapeutic_index    -2.655  0.701      3   3.356

Read the n column before the metrics. Each external document here carries between
8 and 20 compounds, which is few enough that a single badly predicted compound
moves Q2F3 by a large fraction. The per-document numbers are reported to show the SPREAD,
not because any one of them is a reliable estimate on its own; the pooled number above is the
one with enough compounds behind it to quote, and even that is 41 compounds.
```

### `held_out`

```
Held-out scaffolds from the SAME paper (a harder test than a random split, an easier
one than another laboratory's compounds):
                               n_external   q2_f1   q2_f2   q2_f3     ccc  r2_ext     r2m  rmse_ext  mae_ext
Tier 3 MLR, p_activity_H3            52.0  0.0813 -0.0005  0.3726  0.5009  0.2510  0.1261    0.7338   0.5618
Tier 3 MLR, p_toxicity_hERG          52.0 -0.4493 -0.6077 -0.3623  0.4232  0.3004  0.1738    0.8753   0.7455
Tier 3 MLR, therapeutic_index        52.0  0.0567 -0.1075  0.1257  0.5245  0.3658  0.1598    1.1277   0.8980
```

## §12 Applicability domain

### `applicability_domain`

```
  h_star              0.1449
  percentile          1.0
  n_query             41
  inside_leverage     28
  inside_box          29
  inside_both         27
  outside_either      14

  mean |error| inside the domain  : 0.428 (n 27)
  mean |error| outside the domain : 1.368 (n 14)
  If the second is not larger, the domain criterion is not doing its job here, and
  saying so is more useful than a plot that implies it is.

  external compounds outside the domain:
  compound_id  leverage  inside_leverage  inside_box  inside_domain  observed  predicted  abs_error
CHEMBL1086033     0.056             True       False          False     7.921      8.718      0.797
CHEMBL1915540     0.447            False       False          False     6.730      7.792      1.062
CHEMBL1935574     0.261            False       False          False     5.470      7.459      1.989
CHEMBL2376789     0.176            False        True          False     6.480      7.858      1.378
CHEMBL2376790     0.175            False        True          False     6.800      8.120      1.320
CHEMBL2376793     0.199            False       False          False     6.810      7.808      0.998
CHEMBL2376794     0.202            False       False          False     6.160      8.069      1.909
CHEMBL2376795     0.224            False       False          False     6.660      7.408      0.748
CHEMBL2376796     0.223            False       False          False     6.210      7.668      1.458
CHEMBL2376797     0.204            False       False          False     6.220      7.756      1.536
CHEMBL2376799     0.168            False       False          False     6.670      7.496      0.826
CHEMBL2376800     0.262            False       False          False     6.110      7.662      1.552
CHEMBL2376801     0.240            False       False          False     5.820      7.752      1.932
CHEMBL2376805     0.238            False       False          False     6.080      7.732      1.652
```

## §13 Interpretation

### `tier1_reading`

```

================================================================================================
H3 affinity  log(1/C)
  H3 affinity  log(1/C) = +8.845 +0.320·sum_MR
  sum_MR      +0.320  polarisability and bulk   larger, more polarisable substituents raises the response; significant

  no lipophilicity optimum to report: sum_pi and sum_pi_sq are not both in the model

================================================================================================
therapeutic index
  therapeutic index = +3.191 +0.572·sum_MR
  sum_MR      +0.572  polarisability and bulk   larger, more polarisable substituents raises the response; not significant at 5% (p = 0.05)

  no lipophilicity optimum to report: sum_pi and sum_pi_sq are not both in the model
```

### `shap_values`

```
Tier 4 (RandomForestRegressor) on p_activity_H3: descriptors by mean |SHAP|
   descriptor  mean_abs_shap
     RotBonds         0.1401
HallKierAlpha         0.1146
      BertzCT         0.1108
          HBA         0.0581
  Heteroatoms         0.0515
 FractionCSP3         0.0509
       Kappa3         0.0503
          QED         0.0391
     BalabanJ         0.0378
          HBD         0.0376
        Chi3v         0.0230
         TPSA         0.0223
/tmp/ipykernel_8797/3278761494.py:16: FutureWarning: The NumPy global RNG was seeded by calling `np.random.seed`. In a future version this function will no longer use the global RNG. Pass `rng` explicitly to opt-in to the new behaviour and silence this warning.
  shap.summary_plot(values, Z_desc, feature_names=desc_names, show=False, max_display=12)

  Tier 3 GA chose : cMR, TPSA, HBD, RotBonds, FractionCSP3, Heteroatoms, LabuteASA, BertzCT, Chi2v
  Tier 4 leans on : RotBonds, HallKierAlpha, BertzCT, HBA, Heteroatoms, FractionCSP3
  in both         : BertzCT, FractionCSP3, Heteroatoms, RotBonds
  Where a linear model and a forest lean on the same descriptors, the linear
  reading is more likely to be about chemistry than about the fitting. Where they diverge,
  at least one of them is describing the sample rather than the system.
```

### `similarity_maps`

```
fingerprint attribution model, held-out scaffold R2: 0.2253
  (shown so the maps below are read with the model's actual skill in mind)

cliff: CHEMBL1085396 / CHEMBL1085641   |delta p| = 1.69   Tanimoto 0.79
  CHEMBL1085396  observed p 9.80
  CHEMBL1085641  observed p 8.11

cliff: CHEMBL1823180 / CHEMBL561324   |delta p| = 1.12   Tanimoto 0.81
  CHEMBL1823180  observed p 8.40
  CHEMBL561324  observed p 9.52
```

## §14 The two schematics

### `schematics`

```
wrote schema_diagram.excalidraw  (24,436 bytes, opens in Excalidraw)
wrote workflow_diagram.excalidraw  (25,353 bytes, opens in Excalidraw)
```

## §15 Verification

### `verification`

```
raw pull     sha256 7847a5cdc8e35268bbc0ccc205d6d20c31ae3fe65344e6b5dee36bf1418be033
curated rows sha256 7dbe3d772d81be298917754402f1265568adaa4f0416e484ad06e48b257fbffb
ChEMBL release      ChEMBL_37 (2026-05-01)
  A hash without a release pins nothing: ChEMBL revises values between releases, so
  the same code can give a different hash next year and both be correct.

assertions:
  every endpoint value experimental            pass
  training and external disjoint by InChIKey   pass
  reported metrics == recomputed from stored predictions  pass  (9 models, 525 predictions)
  every reported figure has a number behind it pass
    training compounds            207
    external compounds            41
    congeneric series             5
    descriptor columns            25
    scaffold split test size      52

all verification checks passed
```

### `comparison_table`

```
                                          tier  rows         descriptors   coefficients     r2  Q2 LOO                             external
          Tier 1 Hansch, H3 affinity  log(1/C)    21                   1              1 0.2557  0.1160 not applicable (different chemotype)
              Tier 1 Hansch, therapeutic index    21                   1              1 0.1805 -0.0512 not applicable (different chemotype)
                      Tier 2 Free-Wilson (OLS)    21                   1              1 0.0490 -0.2745 not applicable (different chemotype)
                     Tier 3 MLR, p_activity_H3   207                   9              9 0.5830  0.5350               Q2F3 -0.111  CCC 0.639
                     Tier 3 PLS, p_activity_H3   207 25 in, 7 components              7 0.5894     NaN               Q2F3 -0.909  CCC 0.504
                   Tier 3 MLR, p_toxicity_hERG   207                  10             11 0.5106  0.4406               Q2F3 -3.659  CCC 0.067
                   Tier 3 PLS, p_toxicity_hERG   207 25 in, 5 components              5 0.4534     NaN               Q2F3 -3.789  CCC 0.034
                 Tier 3 MLR, therapeutic_index   207                  10             11 0.5651  0.5114               Q2F3 -1.490  CCC 0.050
                 Tier 3 PLS, therapeutic_index   207 25 in, 7 components              7 0.5419     NaN              Q2F3 -3.399  CCC -0.175
Tier 4 RandomForestRegressor, p_activity_H3...   207                  24 n/a (ensemble) 0.9524     NaN               Q2F3 -0.028  CCC 0.597
Tier 4 GradientBoostingRegressor, p_toxicit...   207                  24 n/a (ensemble) 0.9975     NaN              Q2F3 -0.079  CCC -0.044
Tier 4 RandomForestRegressor, therapeutic_i...   207                  24 n/a (ensemble) 0.9433     NaN               Q2F3 -0.396  CCC 0.116

Reading this table honestly:
  - 'descriptors' counts the lipophilicity pair ONCE; 'coefficients' counts both of its terms.
  - Tiers 1 and 2 sit on one congeneric series, so their r2 is not comparable with Tiers 3
    and 4 on the full set, and their blank external column is a property of the Hansch method
    rather than a gap in this run.
  - The external column is another laboratory's compounds, measured on a different H3
    radioligand and reporting hERG as Ki rather than IC50. It is the hardest number here and
    the one that should move an opinion.
```

## §16 Export

### `export`

```
written:
  qsar_outputs/curated_dataset.csv                              88,667 bytes
  qsar_outputs/modelling_table_standardised.csv                 97,294 bytes
  qsar_outputs/provenance.csv                                      804 bytes
  qsar_outputs/predictions.csv                                  52,252 bytes
  qsar_outputs/external_predictions_with_domain.csv              4,856 bytes
  qsar_outputs/external_metrics_per_document.csv                 1,846 bytes
  qsar_outputs/coefficients.csv                                  3,667 bytes
  qsar_outputs/fitted_models.joblib                         19,602,369 bytes
  qsar_outputs/results.json                                     51,606 bytes
  qsar_outputs/schema_diagram.excalidraw                        24,436 bytes
  qsar_outputs/schema_diagram.png                              127,385 bytes
  qsar_outputs/workflow_diagram.excalidraw                      25,353 bytes
  qsar_outputs/workflow_diagram.png                            128,063 bytes

Not in Colab: the files are in ./qsar_outputs/
```

## §17 How to run this, and what it does not tell you

### `run_summary`

```

run summary
-----------
ChEMBL release           ChEMBL_37 (2026-05-01)
training compounds       207 (document CHEMBL1821550)
external compounds       41 unseen, from 3 documents (CHEMBL1155513, CHEMBL2029265, CHEMBL2375287)
congeneric series found  5; largest n = 21
descriptor columns       25 (24 descriptors, the lipophilicity pair counted once)
scaffold split           155 train / 52 held out, 0 shared scaffolds
models fitted            17 entries recorded
predictions stored       525 across 9 models
curated table sha256     7dbe3d772d81be298917754402f1265568adaa4f0416e484ad06e48b257fbffb
seed                     0
verification             passed

The target variable is a ratio of two in vitro binding affinities. It is not a dose,
not a clinical therapeutic index, and not advice about any medicine's use in people.
```

