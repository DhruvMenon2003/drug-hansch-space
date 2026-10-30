"""The reading of the whiteboard: which cards belong to which stage of the workflow.

`parse_whiteboard.py` recovers the board's graph mechanically. This file is the one
interpretive step, and it is deliberately explicit so it can be argued with: each stage
lists the card numbers that `whiteboard_cards.tsv` gives them, in that file's order, and
every labelled card on the board appears in exactly one stage — including the stages that
this notebook does not implement, which are named `out_of_scope` with the reason.

Card numbers come from parse_whiteboard.py's reading order (top-to-bottom in 220px bands,
left-to-right inside a band) and are stable for a given scene file.
"""

SCENE_SHA256_PREFIX = None  # filled in by the mapping generator

STAGES = [
    {
        "key": "A_sources",
        "title": "A. Where the data comes from",
        "cards": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 23, 24, 25, 26, 27, 28, 32, 33, 34, 35,
                  36, 37, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 250, 251],
        "reading": (
            "A decision tree over sources. It starts at PyTDC / Therapeutic Data Commons and "
            "walks a series of questions - group by target receptor, phenotypic side effects, "
            "clinical trials, standardised activity values, pharmacokinetic exposure, endpoints "
            "not in TDC - to Tox21, ToxCast, ClinTox, SIDER, ChEMBL, and admetSAR 3.0 / "
            "QSAR Toolbox. A separate table lists PubChem, ChEMBL, DrugBank, Papyrus, the "
            "Harmonized Drug Dataset Quality Control set, and DailyMed."
        ),
        "implemented_by": "nb:sources",
    },
    {
        "key": "B_schema",
        "title": "B. The dataset's schema",
        "cards": [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 29, 30, 31, 40,
                  54, 55, 56, 57, 58, 59, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
                  79, 80, 81, 82, 83, 84, 85, 86, 87, 89, 90, 91, 92, 93, 96],
        "reading": (
            "One row per drug, carrying an identifier block (PubChem ID, generic name, "
            "structural identifier, National Drug Code), an annotation block (FDA label, "
            "DrugBank, ATC code) and the two measured blocks, Activity and Tox. The worked "
            "example is the ATC code split into its four levels: cimetidine is one code "
            "(A / 02 / BA / 01) and mannitol is four, which is the '1 Drug 1 ATC Code?' "
            "decision - a drug with several codes becomes several rows."
        ),
        "implemented_by": "nb:schema",
    },
    {
        "key": "C_preprocess",
        "title": "C. Pre-processing and outlier removal",
        "cards": [49, 50, 51, 52, 53, 60, 61, 62, 63, 64, 65, 66, 67, 88, 125],
        "reading": (
            "Remove duplicates, drop rows with missing values, standardise. Then two outlier "
            "tests with different grounds: a property-rule violation (Rule of 5, Rule of 3, "
            "Pfizer's rule) marks a property outlier, and a matched molecular pair inside a "
            "congeneric series with a large pIC50 difference marks a structural outlier - an "
            "activity cliff. Both are removed, and the board asks for the justification to be "
            "written down."
        ),
        "implemented_by": "nb:preprocess",
    },
    {
        "key": "D_selection",
        "title": "D. Selecting the modelling set, and the empty arrow",
        "cards": [104, 105, 106, 108, 112, 247],
        "reading": (
            "Three selection criteria: a common target, standardised units, orthogonal assay "
            "data. The target variable is the Therapeutic Index. One box - 'What are the "
            "properties/structural features?' - has an arrow leading out of it and nothing on "
            "the end: this is the box left for me to fill. A second open question asks what "
            "happens if toxicity is used as a predictor of activity."
        ),
        "implemented_by": "nb:descriptors",
    },
    {
        "key": "E_features",
        "title": "E. Feature selection and dimensionality reduction",
        "cards": [109, 110, 111, 113, 114, 119, 120, 149],
        "reading": (
            "Feature selection by a genetic algorithm whose objective minimises pairwise "
            "intercorrelation. Dimensionality reduction is a yes/no branch over PCA, LDA and "
            "t-SNE (deeptime, openTSNE). Descriptors come from the MORDRED library."
        ),
        "implemented_by": "nb:descriptors,nb:tier1",
    },
    {
        "key": "F_models",
        "title": "F. Model building",
        "cards": [95, 97, 98, 100, 101, 102, 103, 94],
        "reading": (
            "Two columns, regression for a continuous target and classification for a discrete "
            "one, each with its dependencies named. The regression column is led by 'Hansch "
            "Analysis based Multi Linear Regression' and continues through principal component "
            "regression, PLS and kernel PLS, SVR with a Gaussian kernel, random forest, "
            "gradient boosting, MLP and a graph neural network. Libraries: QSPRpred, "
            "QSAR-Co-X, PyQSAR3."
        ),
        "implemented_by": "nb:tier1,nb:tier2,nb:tier3,nb:tier4,nb:tier5",
    },
    {
        "key": "G_tuning",
        "title": "G. Hyperparameter tuning",
        "cards": [107, 115, 121, 122],
        "reading": "Optuna, with median pruning and successive halving.",
        "implemented_by": "nb:tier5",
    },
    {
        "key": "H_validation",
        "title": "H. Validation",
        "cards": [116, 117, 118, 123, 124, 150, 153, 154, 155, 156, 157, 161, 162,
                  164, 165, 166, 167, 129, 133, 134, 135],
        "reading": (
            "Internal validation by Y-randomisation, k-fold, nested cross-validation, "
            "leave-one-out and leave-many-out, reported as R-squared, Q-squared and RMSE. "
            "External validation by the concordance correlation coefficient, citing Chirico "
            "and Gramatica 2011. The split is a scaffold split: Morgan fingerprints, "
            "Bemis-Murcko scaffolds and a Tanimoto cutoff so test molecules are not too "
            "similar to training ones, with Group K-Fold over the clusters; eight clustering "
            "methods are listed, and each cluster is to be checked against a co-crystallised "
            "ligand from the PDB."
        ),
        "implemented_by": "nb:validation,nb:cv",
    },
    {
        "key": "I_interpretation",
        "title": "I. Interpretation",
        "cards": [126, 127, 128, 130, 131, 136, 137],
        "reading": (
            "SHAP, Morgan fingerprint similarity maps, a structure-activity landscape index, "
            "and Hansch-based mechanistic interpretation."
        ),
        "implemented_by": "nb:tier1,nb:tier5",
    },
    {
        "key": "J_domain",
        "title": "J. Applicability domain",
        "cards": [146, 147, 148],
        "reading": (
            "Five metrics: hat leverage, autoencoder error in SMILES reconstruction, a "
            "percentile bounding box over the feature distribution, an envelope method and a "
            "distance method."
        ),
        "implemented_by": "nb:domain",
    },
    {
        "key": "K_hansch",
        "title": "K. The Hansch core",
        "cards": [138, 139, 140, 141, 142, 143, 144, 145, 151, 152, 158, 159, 160, 163,
                  217, 218, 219, 224, 225, 226, 227, 229, 230, 231, 232, 233, 235, 236,
                  237, 240, 241, 242, 243, 244, 132],
        "reading": (
            "The theory, drawn out. Dose-response is sigmoidal with a linear region; AC50 is "
            "read off it and the response variable is log(1/C), or log of the reciprocal of the "
            "minimum effective concentration when the response is binary. Binding energy is the "
            "natural log of the association constant, so a lower AC50 means tighter binding and "
            "a more negative binding-energy change. The linear free-energy assumption: the total "
            "change in binding energy is the sum of the hydrophobic, electronic and steric "
            "contributions of a substituent, with the parabola in log P because a drug must be "
            "water-soluble enough to travel and lipid-soluble enough to enter cells. Hammett's "
            "constant is positive for electron-withdrawing groups; the Taft steric factor is "
            "negative for bulky ones. The equation is written out as "
            "log(1/C) = -a(logP)^2 + b logP + c*sigma + d*Es + error. Two caveats are written on "
            "the board: the relationship needs enough aqueous solubility, and molecules in one "
            "congeneric series can still show activity cliffs. A third says Hansch results should "
            "be checked against binding-energy changes from docking."
        ),
        "implemented_by": "nb:tier1,nb:tier2",
    },
    {
        "key": "L_goal",
        "title": "L. The goal",
        "cards": [246, 248, 99],
        "reading": (
            "'Build and Integrate Multiple Local QSAR models into a single Global QSAR model for "
            "prediction within a therapeutically diverse dataset (Different Anatomical "
            "Therapeutic Chemical Code Levels) curated by Paccanaro Research Labs', written "
            "twice, with the Galeano and Paccanaro 2022 Cell Reports Methods paper cited."
        ),
        "implemented_by": "nb:goal",
    },
    {
        "key": "out_of_scope_clinical",
        "title": "Out of scope here: clinical trials, pharmacokinetics and epidemiology",
        "cards": [168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181,
                  182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195,
                  196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209,
                  210, 211, 212, 213, 214, 215, 216, 220, 221, 222, 223, 228, 234, 238,
                  239, 245, 249],
        "reading": (
            "A large block of study notes alongside the pipeline: clearance and AUC, relative "
            "bioavailability, trial design (randomisation, placebo, double blind, open label, "
            "phase 1), reading relative risk claims honestly, four models for paying trial "
            "participants, and prevalence against incidence."
        ),
        "implemented_by": None,
        "reason_out_of_scope": (
            "These cards are about clinical trial conduct and epidemiology, not about fitting or "
            "validating a QSAR model. Nothing in them feeds a descriptor, an endpoint or a "
            "validation step, so the notebook does not implement them. They are listed here so "
            "it is clear they were read and not missed."
        ),
    },
]

CELL_IDS = {
    "nb:sources": "Section 3, cell `source_pull`",
    "nb:schema": "Section 4, cells `schema` and `atc_split`",
    "nb:preprocess": "Section 5, cells `dedupe_standardise`, `rule_outliers`, `mmp_outliers`",
    "nb:descriptors": "Section 6, cells `select_series`, `substituent_constants`, `descriptor_block`",
    "nb:tier1": "Section 7, cells `tier1_hansch`, `tier1_diagnostics`, `williams`",
    "nb:tier2": "Section 8, cell `tier2_free_wilson`",
    "nb:tier3": "Section 9, cell `tier3_lser`",
    "nb:tier4": "Section 10, cells `tier4_align`, `tier4_comfa`",
    "nb:tier5": "Section 11, cells `tier5_ml`, `tier5_shap`",
    "nb:cv": "Section 12, cell `repeated_cv`",
    "nb:validation": "Section 13, cells `y_randomisation`, `external_ccc`",
    "nb:domain": "Section 14, cell `applicability_domain`",
    "nb:goal": "Section 2, markdown `goal`, and Section 15, cell `comparison_table`",
}
