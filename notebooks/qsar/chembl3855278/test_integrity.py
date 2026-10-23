"""No retraining choices: integrity/negative controls on the frozen pilot."""
from pathlib import Path
import json
import numpy as np
import pandas as pd
import pilot
root=Path(__file__).parent
pilot.verify_frozen(root)
df,mols,info=pilot.prepare(root)
model,base,pred,metrics=pilot.fit_evaluate(df,mols)
changed=df.copy()
changed.loc[changed.split.eq('test'),'pKi'] += 1000
model2,base2,_,_=pilot.fit_evaluate(changed,mols)
assert np.array_equal(model[0].mean_,model2[0].mean_)
assert np.array_equal(model[1].coef_,model2[1].coef_)
assert np.array_equal(base.constant_,base2.constant_)
assert np.allclose(pred.predicted_pKi_train_mean, df.loc[df.split.eq('train'),'pKi'].mean())
shuffled=df.sample(frac=1,random_state=431).reset_index(drop=True)
newsplit,newinfo=pilot.choose_split(shuffled)
assert dict(zip(df.molecule_chembl_id,df.split))==dict(zip(shuffled.molecule_chembl_id,newsplit))
assert len(df)==len(pred) and pred.molecule_chembl_id.is_unique
parameters=json.loads((root/'results'/'model_parameters.json').read_text())
manual=((df[pilot.FEATURES].to_numpy()-np.array(parameters['scaler_mean']))/np.array(parameters['scaler_scale']))@np.array(parameters['ridge_coef'])+parameters['ridge_intercept']
assert np.allclose(manual,pred.predicted_pKi_ridge,atol=1e-12)
report={'frozen_hashes':'pass','heldout_label_perturbation_does_not_change_fit':'pass','row_order_invariant_split':'pass','baseline_train_mean_only':'pass','one_prediction_per_eligible_compound':'pass','transparent_parameters_reproduce_predictions':'pass'}
(root/'integrity_tests.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
