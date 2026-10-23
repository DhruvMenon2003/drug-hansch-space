"""Execute every notebook cell offline and retain outputs; no kernel installation."""
import os, json, socket, hashlib
from pathlib import Path
from IPython.core.interactiveshell import InteractiveShell
from IPython.utils.capture import capture_output
ROOT=Path(__file__).parent
os.chdir(ROOT)
def offline(*args,**kwargs): raise RuntimeError('Network disabled during frozen replay')
socket.create_connection=offline
socket.socket.connect=offline
nb=json.loads((ROOT/'assay_qsar_pilot.ipynb').read_text())
shell=InteractiveShell.instance()
executed=[]
for i,cell in enumerate(nb['cells']):
    if cell['cell_type']!='code': continue
    with capture_output() as captured:
        result=shell.run_cell(''.join(cell['source']),store_history=True)
    if result.error_before_exec or result.error_in_exec:
        raise RuntimeError(f'Cell {i} failed: {result.error_before_exec or result.error_in_exec}')
    outputs=[]
    if captured.stdout: outputs.append({'output_type':'stream','name':'stdout','text':captured.stdout.splitlines(True)})
    if captured.stderr: outputs.append({'output_type':'stream','name':'stderr','text':captured.stderr.splitlines(True)})
    for output in captured.outputs:
        outputs.append({'output_type':'display_data','data':output.data,'metadata':output.metadata})
    cell['outputs']=outputs; cell['execution_count']=len(executed)+1; executed.append(i)
(ROOT/'assay_qsar_pilot.executed.ipynb').write_text(json.dumps(nb,indent=1))
receipt={'executed_cells':executed,'all_code_cells_passed':True,'network':'socket connections blocked','fresh_colab_execution':False,'notebook_source_sha256':hashlib.sha256((ROOT/'assay_qsar_pilot.ipynb').read_bytes()).hexdigest()}
(ROOT/'replay_receipt.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt,indent=2))
