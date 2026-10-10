# Licensing notes: open questions for the project owner

Last reviewed: 2026-10-09. This file records what the licence research found and which questions only the project owner (or counsel)
can settle. It is a record of sources and quotations, **not legal advice**, and nothing in the build, the site text or the code
decides any of these questions silently. Items below marked "OWNER DECISION REQUIRED" are open: the site currently shows
attribution and the neutral sentence "Non-commercial, educational use. A licence for this project's own code and data has not been
chosen yet; each source above keeps its own terms." (footer of `site/index.html`, section "Data sources and licences"). Change that
sentence once a decision is made.

Related files: [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md) (what the published site ships, with licence texts),
[site/vendor/fonts/LICENSES.md](../site/vendor/fonts/LICENSES.md) (font notices), `site/data/provenance.csv` (requests made by the data build).

| # | Question | Severity | Status |
|---|---|---|---|
| 1 | DrugBank-derived drug list published openly; DrugBank terms restrict redistribution | high | OWNER DECISION REQUIRED |
| 2 | CC BY-NC 4.0 (DrugBank) and CC BY-SA 3.0 (ChEMBL) inside one derived dataset | high | OWNER DECISION REQUIRED |
| 3 | WHO ATC/DDD index: "Changing or manipulating the material is not allowed" | medium | OWNER DECISION REQUIRED |
| 4 | IBM Plex Mono: Reserved Font Name "Plex" versus subsetted files | medium | OWNER DECISION REQUIRED |
| 5 | GSAP: licence silent on committing the library to a public repository | low | OWNER DECISION REQUIRED |
| 6 | Licence of this project's own code and data (no LICENSE file exists) | - | OWNER DECISION REQUIRED |
| 7 | Build provenance: releases and versions of DrugBank, ChEMBL, RDKit are not recorded | medium | facts to supply, no legal decision |


## 1. DrugBank-derived drug list published openly; DrugBank terms restrict redistribution

**OWNER DECISION REQUIRED - not decided by the build.**

Severity: high.

### What the repository does

FACTS: site/data/drugs.json publishes the 759-drug selection, generic names, CIDs and ATC codes from a DrugBank-derived table (VERIFIED). The current DrugBank Terms of Use (trust.drugbank.com, Last Updated 2025-09-17) grant a licence 'solely for the purpose of internal, non-clinical educational research purposes' and say the user agrees not to 'distribute, ... host, ... disclose ... or otherwise commercially exploit the Databases ... to make the Databases ... available to any third party', and not to 'copy, modify, or create derivative works of the Databases ... in whole or in part' or 'publish ... or otherwise make available to others' them; the release page says the academic DATASETS are 'released under a Creative Common's Attribution-NonCommercial 4.0 International License' for researchers who are 'a student, professor, or research associate with an academic institution'. The project's own upstream curation README (curation/README.md, 'DrugBank terms') already says the website data is for internal non-commercial use and that a published table should come from the academic XML release (CC BY-NC 4.0). The origin and DrugBank release of the owner's input table ('Drug_Bank_Dataset.tsv.xlsx' / 'Drug Bank Dataset.tsv.md', supplied for an internship) is not documented anywhere I could read, and academic downloads are 'temporarily paused'. I am not drawing a legal conclusion. DECISIONS FOR THE OWNER: (1) confirm where the table came from and under which terms; (2) if it cannot be shown to come from the CC BY-NC academic release, consider rebuilding the drug list from CC0 DrugBank Open Data / another open list, or asking DrugBank (legal@drugbank.com is listed on their Terms page) for written permission; (3) whether the repo owner and the site count as 'non-commercial' under CC BY-NC 4.0's definition ('not primarily intended for or directed towards commercial advantage or monetary compensation'), e.g. keep the site free of ads, sponsorship and paid tiers. The footer and sources text below keep DrugBank attribution as a placeholder until this is settled.

### Operative quotations

Release page (go.drugbank.com/releases/latest, Release 5.1.22, 2026-06-27): "These DrugBank datasets are released under a Creative Common's Attribution-NonCommercial 4.0 International License"; "The Academic License is free and available for researchers who meet the following criteria: You're a student, professor, or research associate with an academic institution / Your research is not primarily for the benefit of a commercial third party / You're building a tool solely for academic purposes"; "All Academic DrugBank dataset downloads are temporarily paused while we update how we distribute DrugBank data."; Open Data: "The DrugBank Open Data datasets are public domain datasets that can be used freely in your application or project (including commercial use). It is released under a Creative Common's CC0 International License."

Terms of Use (trust.drugbank.com .../terms-of-use): "the DrugBank Databases and Platform are made available under these Terms solely for educational, scientific, and non-commercial research purposes unless you have paid for a commercial license subject to a mutually-executed subscriber order."; license grant is "solely for the purpose of internal, non-clinical educational research purposes or non-clinical research and development purposes conducted by you. You agree not to ... distribute, transmit, host, outsource, disclose, or otherwise commercially exploit the Databases, Platform, or Services, to make the Databases, Platform, or Services available to any third party"; Use Restrictions: "(i) copy, modify, or create derivative works of the Databases, Platform, Services or Documentation, in whole or in part; ... (iii) ... distribute, publish, transfer, or otherwise make available to others the Databases, Platform, Services, or Documentation; ... (viii) use the Databases, Platform, or Services to develop another database of drug information, drug-drug interactions, or drug targets except where specifically permitted under a mutually-executed subscriber order"; "You agree not to broadcast, copy, create derivative works based on, display, license, modify, participate in the transfer or sale of, perform, publish, redistribute, reproduce, translate, transmit, upload or otherwise exploit for any purposes whatsoever any content or material from the Databases, Platform, or Services, except as expressly permitted herein, without our express prior written consent."; Attribution clause: "When using DrugBank data that has been licensed to DrugBank from The Governors of the University of Alberta in an academic publication, such data is to be cited as follows: Knox C, Wilson M, Klinger CM, et al. DrugBank 6.0: the DrugBank Knowledgebase for 2024. Nucleic Acids Res. 2024 Jan 5;52(D1):D1265-D1275. doi: 10.1093/nar/gkad976." Plain-language summary on the same site: "Don't copy, resell, or use DrugBank to build products without explicit permission and/or a commercial license." and "Some data in DrugBank comes from external sources, and when that's the case, it may be subject to its own license terms, which still apply." Citing page: "For presentations, include “Data from DrugBank (Knox, Wilson, et al., 2024)” in a footnote or acknowledgment." CC BY-NC 4.0 s.3(a)(1): if You Share the Licensed Material (including in modified form) You must retain creator identification, a copyright notice, a notice referring to the licence and to the disclaimer of warranties, a URI to the material where reasonably practicable, "indicate if You modified the Licensed Material", and indicate it is licensed under the licence with its text or URI. NonCommercial means "not primarily intended for or directed towards commercial advantage or monetary compensation."

### What ships from DrugBank, and what is unknown

WHAT SHIPS FROM DRUGBANK (VERIFIED by reading site/data/drugs.json keys): the selection of 759 drugs, `name` (salt-free generic name), `cid` (dataset PubChem CID), `atc[].code` (938 distinct ATC codes), `flags` (14 'salt removed', 6 'structure shared'). NOT shipped (VERIFIED, absent from drugs.json): DrugBank Biological Target, Toxicity, Therapeutic Index, ADR, pharmacology text. ORIGIN OF THE INPUT TABLE IS UNKNOWN: tools/build_data.py:4 and :272 read 'drugbank_curated_dedup.csv', produced by colab_curate_all.py from an uploaded 'Drug Bank Dataset.tsv.md' (upstream curation/colab_curate_all.py:8,23; upstream curation/README.md:3 calls it 'Drug_Bank_Dataset.tsv.xlsx'). The upstream curation README itself states: 'DrugBank terms. The website data is for internal, non-commercial research use, and the terms restrict building a redistributed database from it. For a published TSV, use the DrugBank academic XML release (CC BY-NC 4.0) and cite DrugBank.' Academic downloads are 'temporarily paused' as of the fetch, so a fresh academic release cannot be obtained right now. DrugBank Open Data (CC0) is only the 'DrugBank Vocabulary' (identifiers, names, synonyms per the release page; page showed 'Temporarily unavailable'); it has no ATC codes. VERIFICATION NOTE: go.drugbank.com/legal/terms_of_use and dev.drugbank.com returned HTTP 403 to both curl and WebFetch; the Terms text above was read from trust.drugbank.com (DrugBank's Trust Center, labelled 'Terms of Use', summary page 'Last Updated: 2025-09-17'). The release page was read via curl (HTTP 200). I did not read the 'Outdated Terms' page.

### Links

- DrugBank Terms of Use (Trust Center): https://trust.drugbank.com/drugbank-trust-center/terms-of-use
- DrugBank release page: https://go.drugbank.com/releases/latest
- Citing DrugBank: https://trust.drugbank.com/drugbank-trust-center/citing-drugbank
- CC BY-NC 4.0 legal code: https://creativecommons.org/licenses/by-nc/4.0/legalcode
- Permission requests: legal@drugbank.com (listed on the Terms page)

### Decisions needed

1. Where did the input table come from, and under which terms? (the repository cannot show it)
2. If it cannot be shown to come from the CC BY-NC academic release: rebuild the list from DrugBank Open Data (CC0) or another open list, or ask DrugBank in writing.
3. Does the site count as "non-commercial" under CC BY-NC 4.0's definition ("not primarily intended for or directed towards commercial advantage or monetary compensation")? Keep it free of ads, sponsorship and paid tiers.


## 2. CC BY-NC 4.0 (DrugBank academic release) and CC BY-SA 3.0 (ChEMBL) inside one derived dataset

**OWNER DECISION REQUIRED - not decided by the build.**

Severity: high.

### Analysis

FACTS: the same per-drug records in drugs.json combine DrugBank-derived fields (name, CID, ATC) with ChEMBL-derived `act` (median pChEMBL, target id, mechanism text, document counts); hansch.json fits are computed from the ChEMBL medians. ChEMBL FAQ: adaptations must be 'redistributed under the same license'. CC BY-SA 3.0 s.4(b): the adaptation may be distributed only under the same licence (or a later version / ported licence with the same elements) and 'You may not offer or impose any terms on the Adaptation that restrict the terms of the Applicable License'. CC BY-NC 4.0 s.2(a)(5): 'You may not offer or impose any additional or different terms or conditions on ... the Licensed Material if doing so restricts exercise of the Licensed Rights', and its NC clause limits use. CC's own FAQ: 'if you create a remix with material licensed under a ShareAlike license, you need to make sure that all of the material contributed to the remix is licensed under the same license or one that CC has named as compatible' and 'if you want to use a remix for commercial purposes, you cannot incorporate material released under one of the NonCommercial licenses'. CC's FAQ also says SA applies 'only if a work is modified and if the work is shared publicly' and that a compilation of unmodified SA works need not itself be SA ('Collection', which CC BY-SA 3.0 s.1 defines as containing the Work 'in its entirety in unmodified form'). Medians and fits are modified/computed values, while target names are verbatim text, so which reading applies to each field is a question for the owner or counsel. No legal conclusion given. OPTIONS TO DISCUSS: (a) publish ChEMBL-derived fields as a separate file under CC BY-SA 3.0 and keep them apart from DrugBank-derived fields in exports; (b) drop one of the two sources (e.g. rebuild the drug list from ChEMBL's own approved-drug records, itself CC BY-SA, plus open identifiers); (c) obtain written permission from DrugBank for combined redistribution. Also decide what licence the repo declares for site/data/*; no single CC licence satisfies both inputs' stated terms on their face. The CSV export feature would redistribute exactly this combination (see exports item).

### Operative quotations

ChEMBL FAQ 'Can you provide more details on licensing?': "The ChEMBL database is licensed under a Creative Commons Attribution-Share Alike 3.0 Unported License (https://creativecommons.org/licenses/by-sa/3.0/). This allows use, redistribution and adaption of ChEMBL as long as appropriate attribution is given (e.g., cite the current ChEMBL paper:) and ensure that any adaptations are redistributed under the same license." Same FAQ: "ChEMBL also includes compound property calculations, derived from commercial software. When using these commercial calculations, users should ensure that they refer to and abide by commercial licensing agreements." About page: "Access to the web interface of ChEMBL is made under the EBI's Terms of Use. The ChEMBL data is made available on a Creative Commons Attribution-Share Alike 3.0 Unported License." ebi.ac.uk/chembl home page: "Provided under a Creative Commons Attribution-Share Alike 3.0 Unported license". EMBL-EBI Terms of Use: "EMBL-EBI imposes no additional restriction on the use of the contributed data than those provided by the data owner, unless otherwise specified in these Terms of Use." and "EMBL-EBI expects attribution (e.g. in publications, services or products) for the use of any of its Data Resources and Tools in accordance with good scientific practice." CC BY-SA 3.0 legal code s.1: "Adaptation means a work based upon the Work, or upon the Work and other pre-existing works, such as a translation, adaptation, derivative work, arrangement of music or other alterations of a literary or artistic work ... including in any form recognizably derived from the original, except that a work that constitutes a Collection will not be considered an Adaptation for the purpose of this License." s.1 Collection: a collection ... "in which the Work is included in its entirety in unmodified form along with one or more other contributions, each constituting separate and independent works in themselves". s.4(b): "You may Distribute or Publicly Perform an Adaptation only under: (i) the terms of this License; (ii) a later version of this License with the same License Elements as this License; (iii) a Creative Commons jurisdiction license ... that contains the same License Elements as this License (e.g., Attribution-ShareAlike 3.0 Unported) ('Applicable License') ... You may not offer or impose any terms on the Adaptation that restrict the terms of the Applicable License or the ability of the recipient of the Adaptation to exercise the rights granted to that recipient under the terms of the Applicable License."

### What ships from ChEMBL

WHAT SHIPS (VERIFIED from drugs.json): `act` = {p (median pChEMBL, computed), target (CHEMBL id), tname (ChEMBL mechanism_of_action text for the first target), types (standard_type list), ndoc (document count), chembl (parent molecule id)} for 308 of 759 drugs, plus `chembl` id; site/data/hansch.json holds fits and per-drug observed/fitted/LOO points derived from these medians. Derivation code: upstream curation/colab_curate_all.py (potency(), ~lines 200-230) queries ebi.ac.uk/chembl/api/data/{molecule,mechanism,activity}.json live; no ChEMBL release is recorded in the shipped data: drugs.json meta.sources lists only pubchem, who_atc and the curated CSV name (VERIFIED tools/build_data.py:437), and site/data/provenance.csv logs only atcddd.fhi.no and pubchem requests (VERIFIED: 162 + 149 rows). ChEMBL's own calculated compound properties are NOT used (VERIFIED: all descriptors come from RDKit, tools/build_data.py:139-147; the activity query asks only for pchembl_value, standard_type, assay/document/target ids). WHETHER the median values and fits count as an 'Adaptation' or fall under 'Collection' is a licence-reading question left to the owner (see conflicts). I did not read ChEMBL's separate 'Downloads' README; the FAQ and About pages were read via curl (HTTP 200).

### Links

- ChEMBL licensing FAQ: https://chembl.gitbook.io/chembl-interface-documentation/frequently-asked-questions/general-questions
- ChEMBL about page: https://chembl.gitbook.io/chembl-interface-documentation/about
- CC BY-SA 3.0 legal code: https://creativecommons.org/licenses/by-sa/3.0/legalcode
- CC BY-NC 4.0 legal code: https://creativecommons.org/licenses/by-nc/4.0/legalcode
- EMBL-EBI Terms of Use: https://www.ebi.ac.uk/about/terms-of-use/
- Creative Commons FAQ on remixing ShareAlike and NonCommercial material: https://creativecommons.org/faq/


## 3. WHO ATC/DDD index: "Changing or manipulating the material is not allowed"

**OWNER DECISION REQUIRED - not decided by the build.**

Severity: medium.

### Analysis

The WHOCC notice says 'Use of all or parts of the material requires reference to the WHO Collaborating Centre for Drug Statistics Methodology. Copying and distribution for commercial purposes is not allowed. Changing or manipulating the material is not allowed.' The site ships 893 WHO names (verbatim), per-drug ATC codes, and Adm.R route codes re-mapped to FDA names (who_to_fda_route.csv, with rows flagged 'coarse' and 'check'). A non-commercial site meets the 'commercial purposes' limb as stated, but the mapping/re-grouping and the republication of 893 names is for the owner to weigh against 'changing or manipulating'. PROCESS: tools/build_data.py:46,275-282 scrapes atcddd.fhi.no HTML; robots.txt has 'Crawl-Delay: 10' and the provenance timestamps show 162 pages in 35 s. The ordering portal (official downloads) was unreadable (JavaScript) so its licence is NOT VERIFIED. WHOCC also says the system should be cited by version and that using it for purposes other than drug utilisation statistics 'can be inappropriate'. The source table's ATC codes may come from an older index than the 2026 names fetched on 2026-10-09; the page should state which year. Suggested: email whocc@fhi.no for written permission/clarification; show the citation 'WHO Collaborating Centre for Drug Statistics Methodology, ATC classification index with DDDs, 2026. Oslo, Norway 2026.'; honour the crawl delay on any rebuild.

### Operative quotations

Copyright/Disclaimer page (Last updated 2009-12-14): "Use of all or parts of the material requires reference to the WHO Collaborating Centre for Drug Statistics Methodology. Copying and distribution for commercial purposes is not allowed. Changing or manipulating the material is not allowed." and "The Centre cannot guarantee and assumes no legal liability or responsibility for the accuracy, completeness or interpretation of the information." ATC Index with DDDs page (Last updated 2026-01-28): "Suggested citation: When referring to or using data from the ATC index with DDDs, the following citation should be used: WHO Collaborating Centre for Drug Statistics Methodology, ATC classification index with DDDs, 2026. Oslo, Norway 2026." Use of ATC/DDD page (Last updated 2022-11-25): "Thus, it is important to give proper references to the ATC/DDD version used when presenting drug consumption figures."; "The main purpose of the ATC/DDD system is as a tool for presenting drug utilization statistics with the aim of improving drug use. ... Consequently, using the system for other purposes can be inappropriate."; "It should be emphasised that assignment to different ATC groups does not mean a difference in therapeutic effectiveness and assignment to the same ATC group does not indicate therapeutic equivalence." robots.txt (atcddd.fhi.no): "User-agent: * Crawl-Delay: 10".

### What ships from WHO

WHAT SHIPS (VERIFIED): drugs.json meta.atc_names has 893 WHO names (14 level-1, 76 level-2, 162 level-3, 641 level-4); each drug carries its ATC level-5 codes (938 distinct); route strings for 624 of 938 (CID, ATC) pairs come from WHO Adm.R codes in the source table (VERIFIED by counting upstream curation/inputs/mode_of_administration.md: 624 pairs have a code, 314 had 'NaN' and were filled from US labels), mapped by upstream curation/inputs/who_to_fda_route.csv (e.g. 'P' to PARENTERAL, flagged 'coarse'; four rows flagged 'check'). The WHO names were scraped from atcddd.fhi.no HTML (tools/build_data.py:46,275-282): 162 pages fetched within 35 s per site/data/provenance.csv timestamps, against robots.txt 'Crawl-Delay: 10' (advisory directive). The ordering portal https://orders.atcddd.fhi.no/ is a JavaScript app; its terms were NOT readable and are NOT VERIFIED. The 'Changing or manipulating the material is not allowed' sentence is the item to settle (names are copied verbatim, but codes are re-mapped to FDA route names and re-grouped). Email for permission questions on the WHOCC pages: whocc@fhi.no.

### Links

- WHOCC copyright and disclaimer: https://atcddd.fhi.no/copyright_disclaimer/
- ATC/DDD index and guidelines (citation): https://atcddd.fhi.no/atc_ddd_index_and_guidelines/
- Use of ATC/DDD: https://atcddd.fhi.no/use_of_atc_ddd/
- Permission and clarification: whocc@fhi.no


## 4. IBM Plex Mono: Reserved Font Name "Plex" versus subsetted files

**OWNER DECISION REQUIRED - not decided by the build.**

Severity: medium.

### Analysis

VERIFIED: site/vendor/fonts contains woff2 files and fonts.css only; fonts.css line 1 points to 'LICENSES.md', which does not exist, and the woff2 name tables carry a copyright string but no embedded licence text. OFL clause 2 requires each copy to contain the copyright notice and the licence (stand-alone text file is acceptable). ACTION (no decision needed): add site/vendor/fonts/LICENSES.md (or the three OFL.txt files) with the verbatim OFL text and copyright lines given in THIRD_PARTY_LICENSES below. SEPARATE DECISION: IBM Plex Mono's OFL names the Reserved Font Name 'Plex'; the shipped files are 280-glyph subsets whose internal family name is still 'IBM Plex Mono'. OFL FAQ 2.2 says format changes are normally modification and RFNs cannot then be used, with a narrow exception for unchanged WOFF compression. Bricolage Grotesque and Newsreader have no RFN in their OFL.txt. Options: replace the two Plex files with IBM's own woff2 (@ibm/plex-mono 2.5.0), or ask IBM, or rename the subset family internally.

### Font facts

Same notice requirement as above. Reserved-name rule, OFL clause 3: "No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted by the corresponding Copyright Holder. This restriction only applies to the primary font name as presented to the users." OFL FAQ 2.2: "A change in font format normally is considered modification, and Reserved Font Names (RFNs) cannot be used. ... You are allowed to create, use and distribute a WOFF version of an OFL font without changing the font name, but only if the original font data remains unchanged except for WOFF compression". Whether these subsetted files count as 'Modified Version' under the RFN rule is for the owner; a cleaner route is IBM's own woff2 release (@ibm/plex-mono 2.5.0, OFL-1.1 on npm, published by the RFN holder).

Files affected: `site/vendor/fonts/ibm-plex-mono-normal-400-latin.woff2`, `site/vendor/fonts/ibm-plex-mono-normal-500-latin.woff2`
(280-glyph subsets whose internal family name is still "IBM Plex Mono"). The OFL text with the Reserved Font Name statement is in
`site/vendor/fonts/LICENSES.md`.

### Links

- IBM Plex licence: https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt
- OFL FAQ (section 2.2 on format changes and Reserved Font Names): https://openfontlicense.org/ofl-faq/
- Replacement option: `@ibm/plex-mono` 2.5.0 on npm, published by the Reserved Font Name holder.

The other two fonts (Bricolage Grotesque, Newsreader) have no Reserved Font Name in their OFL notice. The missing notice itself is fixed:
the OFL texts and copyright lines are now in `site/vendor/fonts/LICENSES.md`.


## 5. GSAP: licence silent on committing the library to a public repository

**OWNER DECISION REQUIRED - not decided by the build.**

Severity: low.

### Analysis

Current Standard 'No Charge' licence (effective April 30, 2025, last modified May 30, 2025) permits free use on 'any website, web application, or digital interface' including commercial, with listed restrictions (Webflow-competing visual animation builders, reverse engineering for Competitive Products, removing proprietary notices). It grants the right to 'use, reproduce, display, and implement' and does not mention redistribution, sublicensing, forking or hosting copies in a public Git repository. Serving the unmodified, header-intact files from Pages is within the quoted wording; whether a public repo copy is a 'redistribution' needing separate permission is not addressed. Webflow may amend the terms. Options: keep as is and archive the licence text; fetch GSAP at CI build time rather than committing it; ask Webflow/GSAP in writing; or replace ScrollTrigger with native scroll handling (cost: tour rewrite).

### Licence terms as read on 2026-10-09

Licence text (current): grant is "a non-exclusive, worldwide license to use, reproduce, display, and implement GSAP Products solely for Permitted Uses"; "'Permitted Uses' means the implementation and/or use of GSAP Products on any website, web application, or digital interface by any person or entity"; Plain English: "You may use the code at no charge in commercial or non-commercial apps, web sites, games, components, and other software as long as end users are not charged a fee of any kind"; restrictions: no use in tools that "allow users to build visual animations without code" that compete with Webflow's visual animation builder, no reverse engineering to make Competitive Products, and "Remove or alter any proprietary notices or branding from GSAP Products" is prohibited (keep headers intact: the vendored files are unmodified). FAQ: "Can I really use GSAP in commercial projects without paying anything? Yes, really!" ANSWER TO THE OWNER'S QUESTION: serving the unmodified files from your own GitHub Pages site fits the quoted 'Permitted Uses' wording; the text does not mention committing the files to a public repository or redistributing them to third parties as a download, in either direction. The Amendments clause lets Webflow change the terms (you may keep using previous versions 'under the applicable terms licensed to you prior to the effective date'). Keep a dated copy of the licence page (fetched 2026-10-09) in the repo notes. Alternatives if the owner wants zero doubt: install via npm in CI and copy into the Pages artifact without committing the files, or ask GSAP/Webflow in writing.

Files: `site/vendor/gsap/gsap.min.js` (GSAP 3.12.5 core). The ScrollTrigger plugin file was removed from the site in the baseline runtime
stage (the tour now uses an IntersectionObserver), so only the core is vendored. The file headers are unmodified and read
"@license Copyright 2024, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license".

### Links

- https://gsap.com/standard-license/
- https://gsap.com/licensing/


## 6. Licence of this project's own code and data

**OWNER DECISION REQUIRED - not decided by the build.**

No `LICENSE` file exists in this repository or its upstream (`drug-toxicity-qsar-prediction`), and the build does not choose one. The README
carries a marked TODO for it. Two inputs impose different conditions on combined data (items 1 and 2), so the licence line for
`site/data/*` is deliberately left open; no single Creative Commons licence satisfies both inputs' stated terms on its face.


## 7. Build provenance: releases and versions that are not recorded

No legal decision is needed here, only facts that the owner has to supply (they are needed for the CC BY-NC / BY-SA attribution
and for the WHOCC rule of citing the version).


drugs.json meta.sources lists only pubchem, who_atc and the CSV file name; site/data/provenance.csv covers only the 311 requests of build_data.py (atcddd.fhi.no 162, pubchem 149, all cached 200s). The DrugBank release, ChEMBL release (ChEMBL_37 is current as of 2026-10-09 per status.json, release date 2026-05-01, but the build date is not tied to a release), openFDA/DailyMed requests, RDKit version and the curation-step provenance are not in the repo. CC BY-NC/BY-SA attribution and WHOCC version citation need these. ACTION: add a SOURCES.md or extend meta with release/version/date for each source and copy the upstream curation provenance.csv if it exists; no owner decision needed other than supplying the facts.

Specifically not recorded anywhere in the repository:

- the DrugBank release (and the origin and licence of the input table `drugbank_curated_dedup.csv`);
- the ChEMBL release the activities were queried from (ChEMBL_37, released 2026-05-01, was current on 2026-10-09, but the build date is not tied to a release);
- the RDKit version used for the build (the research environment had 2026.09.1; the build machine is not recorded);
- the versions of pandas, numpy, scikit-learn and requests; marimo-chem-utils 0.2.4 and useful-rdkit-utils 2.0.1 are known;
- the ATC/DDD index year that the source table's ATC codes come from (the names were fetched on 2026-10-09 from the 2026 index);
- the openFDA and DailyMed requests of the earlier curation step (`site/data/provenance.csv` lists only the 311 requests of `tools/build_data.py`:
  162 to atcddd.fhi.no and 149 to PubChem, all served from cache with status 200).

Suggested fix: add a `SOURCES.md` or extend `meta` in `site/data/drugs.json` with release, version and date per source, and copy the upstream
curation provenance file if it exists.


## Items that need action but no owner decision

### Exports (CSV and PNG) and deep links re-distribute the same data

Severity: low.

A CSV export of names, ATC codes, descriptors and ChEMBL potency re-shares DrugBank-, WHO- and ChEMBL-derived fields outside the page, where the footer is not visible. CC BY-NC 4.0 and BY-SA 3.0 both require notices to travel with shared material 'in any reasonable manner based on the medium'. Suggested header for the CSV (comment rows) and a caption strip on the PNG: '# Drug Hansch Space export, <date>. Contains data from DrugBank [CONFIRM], ChEMBL <release> (CC BY-SA 3.0), WHO ATC/DDD Index 2026 (WHO Collaborating Centre for Drug Statistics Methodology), PubChem (NCBI/NLM). Descriptors computed with RDKit. Not medical advice. Sources and licences: <site URL>#sources'. Resolve the licence question above before choosing an export licence line.

### PubChem per-record rights and 'Title' field

Severity: low.

NCBI says it places no restrictions but submitters may claim rights, and PubChem says data sources may carry their own licences. The shipped fields are mostly NCBI-computed (XLogP3, complexity, parent CID, 3D conformer) plus `title`, which can be depositor-supplied. Low risk; no source-level licence was found that restricts these uses. Cite PubChem and NLM as given; keep request rate under 5/s (the build does).

### Wording in the existing page that the sources do not support

Severity: low.

site/index.html:27 says '759 approved drugs from the curated DrugBank set'; nothing in this repo verifies approval status for all 759 (the input filter is unknown). site/index.html:197 and :205 refer to 'drugbank_curated_dedup.csv (curation/colab_curate_all.py)' and 'python explorer/build_data.py ... explorer/data/provenance.csv', paths that do not exist in the new repo (tools/ and site/data/). Line 201 'Toxicity is still empty in the source table' is accurate and should stay. Suggest 'drugs' instead of 'approved drugs' unless the owner can document the filter. DrugBank's own terms also state its data is 'NOT INTENDED AS A SUBSTITUTE FOR PROFESSIONAL MEDICAL ADVICE'.

### Test-only XR emulator must stay out of the published site

Severity: low.

iwer / @iwer/devui / @iwer/sem 2.5.0 are MIT (Meta Platforms) and webxr-polyfill is Apache-2.0; none needs to ship. Only upload site/ to Pages (not the repo root) and keep emulator code under tests/ or node_modules. If any emulator file is copied into the repo, list it in THIRD_PARTY_LICENSES.md with its licence.

## What the site currently says about licences

For transparency, these are the statements on the page that depend on the open items above (all in the footer of `site/index.html`):

- The sources table names DrugBank, WHOCC, ChEMBL, PubChem, openFDA/DailyMed and RDKit with links to each source's own terms. For DrugBank it says that DrugBank
  "offers its academic release under CC BY-NC 4.0" (a fact about DrugBank's offer, not a statement about this site's licence) and that the release is not recorded.
- "Non-commercial, educational use. A licence for this project's own code and data has not been chosen yet; each source above keeps its own terms."
- The word "approved" is not used for the drugs: the page says "drugs from a curated DrugBank-derived table" because approval status is not verified in this repository.
- The exports (CSV, PNG) and deep links re-distribute the same data outside the page; they must carry the source and licence notice (suggested text in section "Exports" above).
