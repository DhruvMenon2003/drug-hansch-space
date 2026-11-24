// Hand-written normalisation tables (reviewed by Claude, 2026-11-23). Left = helper's rule name, right = canonical rule name.
export const CANON = {
  'Sirt1 Activator': 'Sirtuin 1 Activator', 'SIRT1 Activator': 'Sirtuin 1 Activator', 'Sirtuin Activator': 'Sirtuin 1 Activator',
  'Dopamine-2 Receptor Antagonist': 'Dopamine D2 Receptor Antagonist',
  'Serotonin-2a Receptor Antagonist': 'Serotonin 5-HT2A Receptor Antagonist',
  'Sigma-1 Receptor Agonist': 'Sigma 1 Receptor Agonist',
  'NMDA Glutamate Receptor Antagonist': 'NMDA Receptor Antagonist',
  'Melatonin MT1/MT2 Receptor Agonist': 'Melatonin Receptor Agonist',
  'mTOR Inhibitor': 'mTORC1 Inhibitor',
  '5HT3 Receptor Antagonist': 'Serotonin 5-HT3 Receptor Antagonist',
  'ADP P2Y12 Receptor Antagonist': 'P2Y12 Receptor Antagonist',
  'Opioid Mu Receptor Antagonist': 'Mu Opioid Receptor Antagonist',
  'Oestrogen Receptor Agonist': 'Estrogen Receptor Agonist',
  'S6K1 Inhibitor': 'Ribosomal Protein S6 Kinase 1 Inhibitor',
  'CYP2E1 Activator': 'Cytochrome P450 2E1 Activator',
};
// Book drug name (lower case) -> DrugBank name to look up. null = a class or a compound with no single DrugBank entry.
export const ALIAS = {
  'zyprexa (olanzapine)': 'Olanzapine', 'δ9-thc': 'Dronabinol', 'aea': 'Anandamide', '2-ag': '2-Arachidonoylglycerol',
  'calcitriol (1,25(oh)2-cholecalciferol)': 'Calcitriol', 'oestradiol': 'Estradiol', 'fenobibric acid': 'Fenofibric acid',
  'alcohol': 'Ethanol', 'alcohol (ethanol)': 'Ethanol', 'sr141716': 'Rimonabant', 'donepezil hydrochloride': 'Donepezil',
  'nad+': 'NADH', 'amp': 'Adenosine phosphate', 'dextromethorphan/quinidine (dm/q)': 'Dextromethorphan', 'rapamycin': 'Sirolimus',
  '2-deoxy-d-glucose (2dg)': '2-deoxyglucose', 'win 55, 212-2': 'WIN 55212-2', 'hu-210': 'HU-210', 'cp55940': 'CP-55940',
  'fibrates': null, 'coumarins': null, 'fatty acids and their derivates': null, 'r-130964': null,
};
// Display name for the spreadsheet (book spelling kept in its own column).
export const DISPLAY = { 'alcohol': 'Ethanol', 'alcohol (ethanol)': 'Ethanol', 'aea': 'Anandamide', 'zyprexa (olanzapine)': 'Olanzapine', 'oestradiol': 'Estradiol', 'fenobibric acid': 'Fenofibric acid', 'donepezil hydrochloride': 'Donepezil', 'calcitriol (1,25(oh)2-cholecalciferol)': 'Calcitriol', 'dextromethorphan/quinidine (dm/q)': 'Dextromethorphan/quinidine', 'rapamycin': 'Rapamycin (sirolimus)', 'sr141716': 'SR141716 (rimonabant)', '2-ag': '2-Arachidonoylglycerol (2-AG)', 'δ9-thc': 'Δ9-THC (dronabinol)' };
