#!/usr/bin/env python3
"""Offline, prespecified one-assay curation. Never fits or chooses a split from labels."""
import csv,json,math,hashlib,platform
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path
from rdkit import Chem,rdBase
from rdkit.Chem.MolStandardize import rdMolStandardize
from rdkit.Chem.Scaffolds import MurckoScaffold
ROOT=Path(__file__).resolve().parent
RULES_SHA='487c5f9a8f41f01cb953a3c39b8b6bd7cc4db0d61e299e7788d2e6c847224253'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if sha(ROOT/'cohort_rules.json')!=RULES_SHA:raise SystemExit('Curation rules changed; stop before parsing')
man=json.loads((ROOT/'source_manifest.json').read_text())
for req in man['requests']:
 if sha(ROOT/req['file'])!=req['sha256']:raise SystemExit('Raw snapshot hash mismatch')
a=json.loads((ROOT/'raw/assay.json').read_text());t=json.loads((ROOT/'raw/target.json').read_text())
assert a['assay_type']=='B' and a['assay_organism']=='Homo sapiens' and a['confidence_score']==9 and a['relationship_type']=='D'
assert t['target_type']=='SINGLE PROTEIN' and t['organism']=='Homo sapiens' and len(t['target_components'])==1 and t['target_components'][0]['accession']=='P14416'
rows=[]
for req in man['requests']:
 if 'activities_page_' in req['file']: rows.extend(json.loads((ROOT/req['file']).read_text())['activities'])
assert len(rows)==man['api_total_count']==man['retrieved_rows'] and len({r['activity_id'] for r in rows})==len(rows)
raw_fields=list(rows[0]); audited=[];groups=defaultdict(list)
def number(x):
 try:y=float(x);return y if math.isfinite(y) else None
 except (TypeError,ValueError):return None
for r in sorted(rows,key=lambda r:r['activity_id']):
 reasons=[];extras={};pki=None
 for field,value in [('assay_chembl_id','CHEMBL3855278'),('target_chembl_id','CHEMBL217'),('document_chembl_id','CHEMBL3853329'),('target_organism','Homo sapiens'),('assay_type','B')]:
  if r.get(field)!=value:reasons.append('mismatch_'+field)
 if r.get('assay_variant_accession') or r.get('assay_variant_mutation'):reasons.append('unreviewed_target_variant')
 if r.get('relation')!='=':reasons.append('nonexact_or_missing_original_relation')
 if r.get('standard_relation')!='=':reasons.append('nonexact_or_missing_standard_relation')
 if r.get('standard_type')!='Ki' or r.get('standard_units')!='nM':reasons.append('standard_endpoint_or_unit_not_Ki_nM')
 if r.get('data_validity_comment'):reasons.append('source_validity_flag')
 if r.get('potential_duplicate') not in (0,None):reasons.append('source_duplicate_flag')
 if r.get('activity_comment'):reasons.append('activity_comment_requires_review')
 value=number(r.get('value'));std=number(r.get('standard_value'))
 if value is None:reasons.append('missing_or_nonfinite_original_value')
 elif r.get('type')=='pKi' and r.get('units') in (None,'','dimensionless'):
  pki=value;extras['label_origin']='source_reported_pKi'
 elif r.get('type')=='Ki' and r.get('units') in {'M','mM','uM','µM','nM','pM'} and value>0:
  factor={'M':1,'mM':1e-3,'uM':1e-6,'µM':1e-6,'nM':1e-9,'pM':1e-12}[r['units']]
  pki=-math.log10(value*factor);extras['label_origin']='source_Ki_explicit_molar_conversion'
 else:reasons.append('unsupported_original_endpoint_or_unit')
 if std is None or std<=0:reasons.append('missing_or_nonpositive_standard_value')
 if pki is not None and std is not None and std>0:
  nm=10**(9-pki);tol=max(.00501,1e-6*nm)
  extras.update({'pKi':pki,'expected_Ki_nM_from_original':nm,'standard_Ki_nM':std,'roundtrip_pKi':9-math.log10(std),'roundtrip_minus_source_pKi':9-math.log10(std)-pki,'standard_Ki_nM_minus_original_conversion':std-nm,'conversion_tolerance_nM':tol})
  if abs(std-nm)>tol:reasons.append('original_standard_scale_disagreement')
 try:
  mol=Chem.MolFromSmiles(r.get('canonical_smiles') or '')
  if mol is None or mol.GetNumAtoms()==0:raise ValueError('unparseable_or_empty')
  parent=rdMolStandardize.Uncharger().uncharge(rdMolStandardize.FragmentParent(rdMolStandardize.Cleanup(mol)))
  Chem.SanitizeMol(parent)
  iso=Chem.MolToSmiles(parent,canonical=True,isomericSmiles=True)
  noniso=Chem.MolToSmiles(parent,canonical=True,isomericSmiles=False)
  key=Chem.MolToInchiKey(parent)
  if not key:raise ValueError('no_inchikey')
  extras.update({'parent_smiles':iso,'parent_isomeric_smiles':iso,'parent_inchikey':key,'parent_nonisomeric_smiles':noniso,'parent_connectivity_key':hashlib.sha256(noniso.encode()).hexdigest(),'scaffold_smiles':MurckoScaffold.MurckoScaffoldSmiles(mol=parent,includeChirality=False),'structure_changed_from_source':Chem.MolToSmiles(mol,canonical=True,isomericSmiles=True)!=iso})
 except Exception as e:reasons.append('structure_error:'+type(e).__name__)
 item={'source':r,'audit':extras,'reasons':reasons};audited.append(item)
 if extras.get('parent_isomeric_smiles'):groups[extras['parent_isomeric_smiles']].append(item)
# Do not inspect response agreement to decide duplicate exclusion: all multi-record identities excluded.
for group in groups.values():
 if len(group)>1:
  for x in group:x['reasons'].append('multiple_source_records_for_full_parent_identity')
for x in audited:
 x['audit']['source_records_for_full_identity']=len(groups.get(x['audit'].get('parent_isomeric_smiles'),[]))
 x['audit']['decision']='include' if not x['reasons'] else 'exclude'
 x['audit']['exclusion_reasons']=';'.join(x['reasons'])
def cell(x):
 if x is None:return 'null'
 if isinstance(x,(dict,list,bool)):return json.dumps(x,sort_keys=True,separators=(',',':'))
 return x
def write(name,records,fields):
 with (ROOT/name).open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
  for r in records:w.writerow({k:cell(r.get(k)) for k in fields})
write('all_activity_rows.csv',rows,raw_fields)
extra_fields=sorted({k for x in audited for k in x['audit']})
ledger=[{**x['source'],**{'audit_'+k:v for k,v in x['audit'].items()}} for x in audited]
ledger_fields=raw_fields+['audit_'+k for k in extra_fields]
write('decision_ledger.csv',ledger,ledger_fields)
write('exclusion_ledger.csv',[r for r in ledger if r['audit_decision']=='exclude'],ledger_fields)
write('duplicate_ledger.csv',[r for r in ledger if r['audit_source_records_for_full_identity']>1],ledger_fields)
write('censoring_and_missing_ledger.csv',[r for r in ledger if r['relation']!='=' or r['standard_relation']!='=' or r['value'] is None or r['standard_value'] is None],ledger_fields)
eligible=[]
for x in audited:
 if x['reasons']:continue
 r=x['source'];z=x['audit']
 eligible.append({'compound_id':z['parent_inchikey'],'molecule_chembl_id':r['molecule_chembl_id'],'parent_molecule_chembl_id':r['parent_molecule_chembl_id'],'activity_id':r['activity_id'],'source_activity_ids':str(r['activity_id']),'assay_chembl_id':r['assay_chembl_id'],'target_chembl_id':r['target_chembl_id'],'document_chembl_id':r['document_chembl_id'],'canonical_smiles':r['canonical_smiles'],'source_canonical_smiles':r['canonical_smiles'],**z,'original_type':r['type'],'original_value':r['value'],'original_units':r['units'],'original_relation':r['relation'],'standard_type':r['standard_type'],'standard_value':r['standard_value'],'standard_units':r['standard_units'],'standard_relation':r['standard_relation'],'pchembl_value':r['pchembl_value'],'potential_duplicate':r['potential_duplicate'],'data_validity_comment':r['data_validity_comment'],'activity_comment':r['activity_comment'],'source_activity_url':f'https://www.ebi.ac.uk/chembl/api/data/activity/{r["activity_id"]}.json'})
assert len({x['compound_id'] for x in eligible})==len(eligible)
write('eligible_compounds.csv',eligible,list(eligible[0]) if eligible else ['compound_id'])
summary={'created_utc':datetime.now(timezone.utc).isoformat(),'api_total':len(rows),'api_complete':man['complete_for_assay_snapshot'],'unique_source_molecule_ids':len({r['molecule_chembl_id'] for r in rows}),'exact_measured_rows_before_identity_exclusion':sum(not [reason for reason in x['reasons'] if reason!='multiple_source_records_for_full_parent_identity'] for x in audited),'included_compounds':len(eligible),'excluded_rows':sum(bool(x['reasons']) for x in audited),'duplicate_full_identities':sum(len(g)>1 for g in groups.values()),'duplicate_rows_excluded':sum(len(g) for g in groups.values() if len(g)>1),'missing_or_nonexact_rows':sum(r['relation']!='=' or r['standard_relation']!='=' or r['value'] is None or r['standard_value'] is None for r in rows),'censored_nonexact_nonmissing_rows':sum(r['relation'] not in ('=',None) or r['standard_relation'] not in ('=',None) for r in rows),'exclusion_reason_counts':dict(Counter(reason for x in audited for reason in x['reasons'])),'eligible_label_origins':dict(Counter(x['label_origin'] for x in eligible)),'structure_changes':sum(bool(x['audit'].get('structure_changed_from_source')) for x in audited),'eligible_connectivity_groups':len({r['parent_connectivity_key'] for r in eligible}),'eligible_scaffolds':len({r['scaffold_smiles'] for r in eligible}),'rdkit_version':rdBase.rdkitVersion,'python_version':platform.python_version(),'rules_sha256':RULES_SHA,'source_manifest_sha256':sha(ROOT/'source_manifest.json'),'curation_script_sha256':sha(Path(__file__)),'eligible_sha256':sha(ROOT/'eligible_compounds.csv'),'raw_snapshot_sha256':{req['file']:req['sha256'] for req in man['requests']},'modeling_response':'pKi: source-original reported pKi; standardized nM and reverse-log pKi are cross-checks only.','remaining_limits':['Source table-to-record repeat mapping unresolved; all multi-record identities excluded conservatively.','Binding Ki derivation/Kd/buffer/isoform not fully independently reconstructed.','Not a regulatory-valid or independent-laboratory validated dataset.','No labels/outcomes used to choose duplicate exclusions or split.']}
(ROOT/'cohort_summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
