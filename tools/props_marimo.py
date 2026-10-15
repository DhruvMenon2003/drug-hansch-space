# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "marimo-chem-utils",
#     "mols2grid",
#     "pandas",
#     "altair",
# ]
# ///
"""Property distributions in marimo: QED and its eight components next to the descriptors site/data already carries, with
the structures of any brushed part of a distribution in a mols2grid grid. Run with `marimo edit tools/props_marimo.py`
(or `marimo run` for app view). The numbers are the ones tools/build_props.py wrote into site/receptor/data/props.json,
so the notebook and the receptor page show the same bins and the same curve; the notebook looks there first (and in a
data/ folder next to it), then reads them from GitHub. Tooling, not published site content: this one may use pip packages."""

import marimo

__generated_with = "0.25.1"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Property distributions in marimo
    The curated DrugBank drugs scored with RDKit's QED (`rdkit.Chem.QED`), its eight component properties and the
    structural alerts that fired, alongside the Crippen log P, molar refractivity, TPSA and the rest that
    `site/data/drugs.json` already stores. **The two families are not interchangeable**: QED's `HBA` counts matches of
    its own acceptor SMARTS, its `HBD` is `CalcNumHBD` and its `AROM` counts the rings left after the aliphatic rings are
    deleted, where the `d.` descriptors use Lipinski's definitions and `CalcNumAromaticRings`. Columns are prefixed
    `QED_` and `D_` so a fit can never mix them; `props.json` meta records the measured difference per pair.
    """)
    return


@app.cell
def _():
    import json
    import urllib.request

    import altair as alt
    import marimo as mo
    import marimo_chem_utils as mcu
    import mols2grid
    import pandas as pd
    return alt, json, mcu, mo, mols2grid, pd, urllib


@app.cell
def _(json, mo, urllib):
    # tools/ is next to site/ in this repository; a data/ folder next to the notebook (the Colab layout) wins if it exists
    _remote = "https://raw.githubusercontent.com/DhruvMenon2003/drug-hansch-space/main/site/"

    def load(name, sub="data"):
        for _dir in [mo.notebook_dir() / "data", mo.notebook_dir().parent / "site" / sub]:
            if (_dir / name).exists():
                return json.loads((_dir / name).read_text())
        with urllib.request.urlopen(_remote + sub + "/" + name) as r:
            return json.load(r)

    drugs_json, props_json = load("drugs.json"), load("props.json", "receptor/data")
    return drugs_json, props_json


@app.cell
def _(drugs_json, mcu, pd, props_json):
    # One row per drug: QED and its components from props.json, the drugs.json descriptors, SMILES for the structures.
    # Column names avoid dots and spaces: altair reads a dot as a nested field and mols2grid puts the name in a template.
    _qed_keys = ["MW", "ALOGP", "HBA", "HBD", "PSA", "ROTB", "AROM", "ALERTS"]
    _d_keys = ["logp", "mr", "tpsa", "mw", "hbd", "hba", "rotb", "arom", "fsp3", "cx", "ro5"]
    _alerts = {a["i"]: a["smarts"] for a in props_json["meta"]["alerts"]["list"]}
    _atc1 = props_json["meta"]["atc"]["level1_names"]
    _by_cid = {d["cid"]: d for d in drugs_json["drugs"]}

    def _row(p):
        d = _by_cid.get(p["cid"], {})
        q = p["qed_props"] or {}
        return {
            "CID": p["cid"], "Name": (p["name"] or "").capitalize(), "SMILES": d.get("smiles"),
            "QED": p["qed"], "Alerts": len(p["alerts"] or []),
            "AlertSMARTS": "; ".join(_alerts[i] for i in (p["alerts"] or [])) or "none",
            "ATC": "; ".join(_atc1.get(c, c).capitalize() for c in p["atc1"]),
            "ATCcodes": " ".join(p["atc"]),
            **{f"QED_{k}": q.get(k) for k in _qed_keys},
            **{f"D_{k}": (d.get("d") or {}).get(k) for k in _d_keys},
        }

    df = pd.DataFrame([_row(p) for p in props_json["drugs"] if p["qed"] is not None and _by_cid.get(p["cid"])])
    mcu.add_image_column(df)                                    # structure thumbnails for the chart tooltips
    # label -> (dataframe column, summary key in props.json), in the order props.json lists them
    choices = {"QED drug-likeness (0-1)": ("QED", "qed")}
    choices.update({props_json["summary"][f"qed.{k}"]["label"]: (f"QED_{k}", f"qed.{k}") for k in _qed_keys})
    choices.update({props_json["summary"][f"d.{k}"]["label"]: (f"D_{k}", f"d.{k}") for k in _d_keys})
    return choices, df


@app.cell(hide_code=True)
def _(choices, df, mo, props_json):
    prop = mo.ui.dropdown(options=choices, value=next(iter(choices)), label="Property")
    _gaps = props_json["meta"]["gaps"]
    mo.vstack([mo.md(f"### Distribution\n{len(df)} drugs, {len(choices)} properties, computed by `tools/build_props.py` "
                     f"with RDKit {props_json['meta']['rdkit_version']} from the stored SMILES. "
                     f"{len(_gaps)} gap(s) recorded in `props.json` meta. Drag a box across the bars to pick a range; "
                     "the structures of the drugs in it are drawn below."), prop])
    return (prop,)


@app.cell
def _(alt, df, mo, pd, prop, props_json):
    col, key = prop.value
    summ = props_json["summary"][key]
    _hist, _kde = summ["hist"], summ["kde"]
    _lo, _hi = _hist["edges"][0], _hist["edges"][-1]
    _x = alt.Scale(domain=[_lo, _hi], nice=False)
    # the same bins the receptor page draws, taken from props.json so the two can never disagree. One layer only: the
    # brush has to map back to these drugs, so the density curve is a second chart under it on the same x scale.
    dist = mo.ui.altair_chart(
        alt.Chart(df).mark_bar(opacity=0.85).encode(
            x=alt.X(f"{col}:Q", bin=alt.Bin(extent=[_lo, _hi], step=_hist["bin_width"]), scale=_x, title=None),
            y=alt.Y("count()", title="Drugs"),
            tooltip=[alt.Tooltip("count()", title="Drugs")]).properties(height=240),
        chart_selection="interval")
    _curve = mo.md("")
    if _kde:                                                    # the precomputed curve, peak normalised to 1
        _n = _kde["grid"]["n"]
        _step = (_kde["grid"]["hi"] - _kde["grid"]["lo"]) / (_n - 1)
        _pts = pd.DataFrame({"x": [_kde["grid"]["lo"] + _step * i for i in range(_n)], "y": _kde["y"]})
        _curve = alt.Chart(_pts).mark_area(color="firebrick", opacity=0.3, line={"color": "firebrick"}).encode(
            x=alt.X("x:Q", scale=_x, title=summ["label"]),
            y=alt.Y("y:Q", title="Density", axis=None)).properties(height=80)
    mo.vstack([dist, _curve, mo.md(
        f"**{summ['label']}** · {summ['source']}  \n"
        f"n {summ['n']} · min {summ['min']} · q1 {summ['q1']} · median {summ['median']} · q3 {summ['q3']} · "
        f"max {summ['max']} · mean {summ['mean']} · sd {summ['sd']} · 1st-99th percentile {summ['p1']} to {summ['p99']}  \n"
        f"{_hist['bins']} bins ({_hist['rule']}"
        f"{', clipped from ' + str(_hist['fd_bins']) if _hist.get('capped_to') else ''}), "
        + (f"{_kde['bw_rule']} bandwidth {_kde['bw']}, peak density {_kde['peak_density']}" if _kde
           else "no density curve: the property does not vary"))])
    return col, dist, summ


@app.cell
def _(col, df, dist, summ):
    # brushing the distribution cross-filters everything below; an empty brush means every drug
    _sel = dist.value
    if _sel is not None and len(_sel) and col in getattr(_sel, "columns", []):
        _lo, _hi = _sel[col].min(), _sel[col].max()
        sel, what = df[(df[col] >= _lo) & (df[col] <= _hi)], f"{summ['label']} from {_lo} to {_hi}"
    else:
        sel, what = df, f"all {len(df)} drugs, no brush"
    sel = sel.dropna(subset=["SMILES"]).sort_values("QED", ascending=False)
    sel = sel.assign(Value=sel[col].round(3) if sel[col].dtype.kind == "f" else sel[col])
    return sel, what


@app.cell(hide_code=True)
def _(mo, sel, what):
    mo.md(f"""
    ### The drugs in that range
    {len(sel)} drugs: {what}. On the left the selected property against QED, coloured by the number of structural
    alerts, with the structure on hover; on the right the same drugs as a mols2grid grid, sorted by QED, where `Value`
    is the selected property and the tooltip lists the alert SMARTS that fired. ALERTS is the most heavily weighted of
    QED's eight components, so it is usually what explains a surprisingly low score.
    """)
    return


@app.cell
def _(col, mcu, mo, mols2grid, sel, summ):
    def _html(grid):
        return getattr(grid, "data", None) or grid._repr_html_()   # mols2grid returns an HTML widget

    if len(sel):
        _chart = mcu.interactive_chart(sel, col, "QED", color_col="Alerts", x_title=summ["label"], y_title="QED")
        _grid = mo.iframe(_html(mols2grid.display(sel, smiles_col="SMILES", subset=["img", "Name", "QED", "Value"],
                                                  tooltip=["Name", "QED", "Value", "Alerts", "AlertSMARTS", "ATC"],
                                                  size=(180, 150))), height="620px")
        mo.hstack([_chart, _grid], widths="equal")
    else:
        mo.md("No drug in that range.")
    return


if __name__ == "__main__":
    app.run()
