"""Offline, fixed single-assay QSAR pilot. Never downloads or tunes."""
from pathlib import Path
import hashlib, json, math, platform, os
CACHE=Path(__file__).parent / "runtime-cache"
for variable, subdir in [("MPLCONFIGDIR","matplotlib"),("XDG_CACHE_HOME","xdg"),("PYSTOW_HOME","pystow")]:
    path=CACHE/subdir; path.mkdir(parents=True,exist_ok=True)
    os.environ.setdefault(variable,str(path))
import importlib.metadata as md
import numpy as np
import pandas as pd
from rdkit import Chem, DataStructs
from rdkit.Chem.Scaffolds import MurckoScaffold
from rdkit.Chem import rdFingerprintGenerator
from useful_rdkit_utils import RDKitDescriptors
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from sklearn.dummy import DummyRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib

FEATURES = ['MolWt','MolLogP','TPSA','NumHDonors','NumHAcceptors']
SEED = 'assay-pilot-v1'

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def verify_frozen(root):
    manifest=json.loads((root/'input_hashes.json').read_text())
    required={'frozen/eligible_compounds.csv','predeclared_recipe.json','pilot.py'}
    if not required.issubset(manifest): raise ValueError('Missing required frozen manifest entries')
    for name, expected in manifest.items():
        relative=Path(name)
        if relative.is_absolute() or '..' in relative.parts: raise ValueError('Unsafe manifest path')
        if sha(root/relative)!=expected:
            raise ValueError(f'Frozen input hash mismatch: {name}')
    return manifest

def choose_split(df):
    df=df.reset_index(drop=True)
    # Union identical scaffold and parent/connectivity groups; never inspect labels.
    def union_groups(use_scaffold):
        parent=list(range(len(df)))
        def find(x):
            while parent[x]!=x:
                parent[x]=parent[parent[x]]; x=parent[x]
            return x
        seen={}
        for i,row in df.iterrows():
            keys=['connectivity:'+row.connectivity_key, 'parent:'+str(row.parent_molecule_chembl_id)]
            if use_scaffold: keys+=['scaffold:'+row.scaffold]
            for key in keys:
                if key in seen: parent[find(i)]=find(seen[key])
                else: seen[key]=i
        groups={}
        for i in range(len(df)): groups.setdefault(find(i),[]).append(i)
        return list(groups.values())
    for scaffold in [True,False]:
        groups=union_groups(scaffold)
        groups.sort(key=lambda g:hashlib.sha256((SEED+'|'+ '|'.join(sorted(df.iloc[g].connectivity_key))).encode()).hexdigest())
        target=max(5,math.ceil(len(df)*.2)); test=[]
        for g in groups:
            if len(test)>=target: break
            if len(df)-len(test)-len(g)>=10: test.extend(g)
        if len(test)>=5:
            labels=np.array(['train']*len(df)); labels[test]='test'
            return labels, {'method':'scaffold_and_parent_grouped' if scaffold else 'connectivity_and_parent_grouped_fallback', 'groups':len(groups), 'group_sizes':sorted(map(len,groups),reverse=True),'target_test_count':target,'achieved_test_fraction':len(test)/len(df),'seed':SEED}
    raise ValueError('Insufficient independent groups for at least 10 training and 5 test compounds; no fit performed')

def prepare(root):
    verify_frozen(root)
    df=pd.read_csv(root/'frozen'/'eligible_compounds.csv')
    if df.molecule_chembl_id.duplicated().any(): raise ValueError('Repeated molecule IDs')
    expected={'assay_chembl_id':'CHEMBL3855278','target_chembl_id':'CHEMBL217','document_chembl_id':'CHEMBL3853329','original_type':'pKi','original_relation':'=','standard_type':'Ki','standard_units':'nM','standard_relation':'=','label_origin':'source_reported_pKi','decision':'include'}
    for column,value in expected.items():
        if not df[column].eq(value).all(): raise ValueError(f'Ineligible cohort field: {column}')
    if not np.array_equal(df.pKi.to_numpy(),df.original_value.to_numpy()): raise ValueError('Label differs from original source pKi')
    if not df.source_records_for_full_identity.eq(1).all(): raise ValueError('Unresolved repeated identity')
    if not (df.standard_Ki_nM.gt(0) & (abs(df.standard_Ki_nM-10**(9-df.pKi))<=df.conversion_tolerance_nM)).all(): raise ValueError('Unit/conversion mismatch')

    mols=[Chem.MolFromSmiles(s) for s in df.parent_smiles]
    if any(m is None for m in mols): raise ValueError('Invalid eligible SMILES')
    if 'parent_molecule_chembl_id' not in df: raise ValueError('Missing parent grouping')
    df['parent_molecule_chembl_id']=df.parent_molecule_chembl_id.fillna(df.molecule_chembl_id)
    df['connectivity_key']=[Chem.MolToSmiles(m,isomericSmiles=False) for m in mols]
    df['scaffold']=[MurckoScaffold.MurckoScaffoldSmiles(mol=m,includeChirality=False) for m in mols]
    calc=RDKitDescriptors(desc_names=FEATURES,hide_progress=True)
    X=np.array([calc.calc_mol(m) for m in mols],dtype=float)
    if not np.isfinite(X).all(): raise ValueError('Nonfinite descriptor: do not silently impute/filter')
    for i,f in enumerate(FEATURES): df[f]=X[:,i]
    df['split'],split_info=choose_split(df)
    train=df.split.eq('train'); test=~train
    for key in ['parent_molecule_chembl_id','connectivity_key']:
        assert not set(df.loc[train,key]) & set(df.loc[test,key]),key
    if split_info['method']=='scaffold_and_parent_grouped':
        assert not set(df.loc[train,'scaffold']) & set(df.loc[test,'scaffold'])
    return df,mols,split_info

def fit_evaluate(df,mols):
    train=df.split.eq('train').to_numpy(); test=~train
    X=df[FEATURES].to_numpy(); y=df.pKi.to_numpy(dtype=float)
    if not np.isfinite(y).all(): raise ValueError('Nonfinite labels')
    ridge=make_pipeline(StandardScaler(),Ridge(alpha=1.0)).fit(X[train],y[train])
    baseline=DummyRegressor(strategy='mean').fit(X[train],y[train])
    assert np.allclose(ridge[0].mean_,X[train].mean(axis=0))
    predictions=df.copy()
    predictions['label_kind']='source_reported_experimental_pKi'
    predictions['predicted_pKi_ridge']=ridge.predict(X)
    predictions['predicted_pKi_train_mean']=baseline.predict(X)
    predictions['residual_observed_minus_predicted']=y-predictions.predicted_pKi_ridge
    predictions['outside_training_descriptor_range']=((X<X[train].min(axis=0))|(X>X[train].max(axis=0))).any(axis=1)
    fpgen=rdFingerprintGenerator.GetMorganGenerator(radius=2,fpSize=2048,includeChirality=False)
    fps=[fpgen.GetFingerprint(m) for m in mols]
    train_indices=np.flatnonzero(train)
    predictions['max_train_morgan_similarity']=[max(DataStructs.TanimotoSimilarity(fps[i],fps[j]) for j in train_indices if j!=i) for i in range(len(df))]
    metrics={}
    for name,col in [('training_mean','predicted_pKi_train_mean'),('ridge_alpha_1','predicted_pKi_ridge')]:
        pred=predictions.loc[test,col].to_numpy()
        metrics[name]={'test_n':int(test.sum()),'MAE':mean_absolute_error(y[test],pred),'RMSE':float(np.sqrt(mean_squared_error(y[test],pred))),'R2':r2_score(y[test],pred)}
    return ridge,baseline,predictions,metrics

def run(root, output=None):
    root=Path(root); output=Path(output or root/'results'); output.mkdir(parents=True,exist_ok=True)
    df,mols,split_info=prepare(root)
    # Persist selected identities before model fit; cannot change using outcomes.
    df[['molecule_chembl_id','connectivity_key','scaffold','split']].to_csv(output/'split_manifest.csv',index=False)
    ridge,baseline,predictions,metrics=fit_evaluate(df,mols)
    df.to_csv(output/'model_dataset.csv',index=False)
    predictions.to_csv(output/'predictions.csv',index=False)
    joblib.dump({'ridge':ridge,'baseline':baseline,'features':FEATURES,'label':'source-reported experimental pKi','training_ids':df.loc[df.split.eq('train'),'molecule_chembl_id'].tolist()},output/'model.joblib')
    # Transparent coefficients allow replay without loading a pickle from elsewhere.
    parameters={'features':FEATURES,'scaler_mean':ridge[0].mean_.tolist(),'scaler_scale':ridge[0].scale_.tolist(),'ridge_coef':ridge[1].coef_.tolist(),'ridge_intercept':float(ridge[1].intercept_),'baseline_mean':float(baseline.constant_.item())}
    (output/'model_parameters.json').write_text(json.dumps(parameters,indent=2))
    reproduced=((df[FEATURES].to_numpy()-ridge[0].mean_)/ridge[0].scale_)@ridge[1].coef_+ridge[1].intercept_
    assert np.allclose(reproduced,predictions.predicted_pKi_ridge,atol=1e-12)
    report={'cohort_n':len(df),'train_n':int(df.split.eq('train').sum()),'test_n':int(df.split.eq('test').sum()),'split':split_info,'holdout_metrics':metrics,'versions':{p:md.version(p) for p in ['numpy','pandas','rdkit','useful_rdkit_utils','scikit-learn']},'python':platform.python_version(),'limitations':['Single assay/document; no external validation.','Very small holdout: metrics are uncertain; no model selection or tuning was performed.','Scaffold grouping does not guarantee unrelated chemistry; nearest training similarity is descriptive.','Descriptors and predictions are calculated; only source Ki/pKi observations are experimental evidence.','No claim of improvement over the separate frozen 250-compound model.']}
    (output/'report.json').write_text(json.dumps(report,indent=2))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    hold=predictions[predictions.split.eq('test')]
    fig,axes=plt.subplots(1,2,figsize=(9,3.5))
    axes[0].scatter(hold.pKi,hold.predicted_pKi_ridge); lo=min(hold.pKi.min(),hold.predicted_pKi_ridge.min()); hi=max(hold.pKi.max(),hold.predicted_pKi_ridge.max())
    axes[0].plot([lo,hi],[lo,hi],'k--'); axes[0].set(xlabel='Source-reported pKi',ylabel='Predicted pKi',title='Untouched holdout')
    axes[1].scatter(hold.predicted_pKi_ridge,hold.residual_observed_minus_predicted); axes[1].axhline(0,color='k',linestyle='--'); axes[1].set(xlabel='Predicted pKi',ylabel='Observed − predicted',title='Holdout residuals')
    fig.tight_layout(); fig.savefig(output/'holdout.png',dpi=150); plt.close(fig)
    return report

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser(); p.add_argument('--root',default=str(Path(__file__).parent)); p.add_argument('--output'); args=p.parse_args()
    print(json.dumps(run(args.root,args.output),indent=2))
