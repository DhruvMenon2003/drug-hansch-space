#!/usr/bin/env python3
"""Bounded official one-assay snapshot. No credentials, binaries, or model fitting."""
import json,hashlib,urllib.request,urllib.parse
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent
RAW=ROOT/'raw';RAW.mkdir(exist_ok=True)
BASE='https://www.ebi.ac.uk'
manifest={'retrieved_utc':datetime.now(timezone.utc).isoformat(),'assay_id':'CHEMBL3855278','scope':'Complete official activities for this one assay; no endpoint filter at retrieval.','requests':[]}
def fetch(url,name):
 req=urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'QSAR-cohort-audit/1.0'})
 t=datetime.now(timezone.utc).isoformat()
 with urllib.request.urlopen(req,timeout=60) as r:
  data=r.read(8*1024*1024+1)
  if len(data)>8*1024*1024:raise RuntimeError('8 MiB response cap exceeded')
  item={'url':url,'final_url':r.url,'retrieved_utc':t,'status':r.status,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'file':'raw/'+name}
  obj=json.loads(data)
  (RAW/name).write_bytes(data);manifest['requests'].append(item)
  (ROOT/'source_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
  return obj
for kind,id in [('assay','CHEMBL3855278'),('target','CHEMBL217'),('document','CHEMBL3853329')]:
 fetch(f'{BASE}/chembl/api/data/{kind}/{id}.json',kind+'.json')
url=f'{BASE}/chembl/api/data/activity.json?assay_chembl_id=CHEMBL3855278&limit=1000&offset=0'
rows=[];expected=None
for page in range(10):
 obj=fetch(url,f'activities_page_{page:03d}.json')
 meta=obj['page_meta'];total=meta['total_count']
 if expected is None:expected=total
 if total!=expected:raise RuntimeError('API total changed during snapshot')
 rows+=obj['activities']
 nxt=meta['next']
 if not nxt:break
 url=urllib.parse.urljoin(BASE,nxt)
 if urllib.parse.urlparse(url).netloc!='www.ebi.ac.uk':raise RuntimeError('Unexpected pagination host')
else:raise RuntimeError('10 page cap exceeded')
if len(rows)!=expected:raise RuntimeError(f'Incomplete snapshot {len(rows)} != {expected}')
ids=[r['activity_id'] for r in rows]
if len(set(ids))!=len(ids):raise RuntimeError('Repeated activity IDs across pages')
manifest.update({'api_total_count':expected,'retrieved_rows':len(rows),'unique_activity_ids':len(set(ids)),'complete_for_assay_snapshot':True})
(ROOT/'source_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'complete':True,'rows':len(rows),'requests':len(manifest['requests'])},indent=2))
from collections import Counter
for key in ['standard_type','standard_units','standard_relation','type','units','relation','assay_type','target_chembl_id','target_organism','document_chembl_id','data_validity_comment','potential_duplicate','activity_comment']:
 print(key,Counter(str(r.get(key)) for r in rows))
