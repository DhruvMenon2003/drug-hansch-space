# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "marimo-chem-utils",
#     "mols2grid",
#     "useful-rdkit-utils",
#     "pandas",
#     "altair",
#     "rdkit",
# ]
# ///
"""QED in marimo: the composite drug-likeness score and each of its eight component properties, one tab
apiece, every distribution drawn with the RDKit desirability curve that QED applies to that property
overlaid, and filterable by ATC group and by mode of administration. Brush any histogram to draw the
molecules in those bins. Run with `marimo edit tools/qed_marimo.py` (or `marimo run` for app view).

The data files are written by tools/build_props.py and tools/build_data.py into site/data; the notebook
looks there first (and in a data/ folder next to it), then reads them from GitHub - the same loader the
sibling notebook tools/hansch_marimo.py uses.

QED is the weighted geometric mean of eight desirability functions, one per property, from
Bickerton GR, Paolini GV, Besnard J, Muresan S, Hopkins AL. Quantifying the chemical beauty of drugs.
Nat Chem. 2012;4(2):90-98. doi:10.1038/nchem.1243. The desirability curves drawn here are RDKit's own
(rdkit.Chem.QED.ads with QED.adsParameters), the same code that produced the stored values, so the curve
and the points cannot drift apart.
"""

import marimo

__generated_with = "0.25.1"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## QED and its eight components
    The curated drugs, scored by RDKit's QED (mean weights). One tab for the composite score and one for
    each of the eight properties it is built from, each showing the distribution over the drugs that pass
    the filters with **the desirability function QED applies to that property** drawn over it on the right
    axis. A desirability of 1 is the ideal value of that property, 0 the worst; QED is the weighted
    geometric mean of the eight. Brush a histogram to draw those molecules.
    """)
    return


@app.cell
def _():
    import json
    import urllib.request

    import altair as alt
    import marimo as mo
    import numpy as np
    import pandas as pd
    from rdkit import Chem
    from rdkit.Chem import Draw, QED

    # Optional helpers. The notebook runs without any of them and says so in the Packages note below.
    try:
        import marimo_chem_utils as mcu
    except ImportError:
        mcu = None
    try:
        import mols2grid
    except ImportError:
        mols2grid = None
    try:
        import useful_rdkit_utils as uru
    except ImportError:
        uru = None
    return Chem, Draw, QED, alt, json, mcu, mo, mols2grid, np, pd, urllib, uru


@app.cell(hide_code=True)
def _(mcu, mo, mols2grid, uru):
    _missing = [n for n, m in [("marimo_chem_utils", mcu), ("mols2grid", mols2grid),
                               ("useful_rdkit_utils", uru)] if m is None]
    mo.md("**Packages.** " + ("All of `marimo_chem_utils`, `mols2grid` and `useful_rdkit_utils` imported, "
                              "so the grids are the rich ones."
                              if not _missing else
                              f"`{'`, `'.join(_missing)}` did not import, so the affected panels fall back "
                              "to plain RDKit drawing (`rdkit.Chem.Draw`) and the rest of the notebook is "
                              "unaffected."))
    return


@app.cell
def _(json, mo, urllib):
    # tools/ is next to site/ in this repository; a data/ folder next to the notebook (the Colab layout)
    # wins if it exists
    _local = [mo.notebook_dir() / "data", mo.notebook_dir().parent / "site" / "data"]
    _remote = "https://raw.githubusercontent.com/DhruvMenon2003/drug-hansch-space/main/site/data/"

    def load(name):
        for _dir in _local:
            if (_dir / name).exists():
                return json.loads((_dir / name).read_text())
        with urllib.request.urlopen(_remote + name) as r:
            return json.load(r)

    props_json, drugs_json = load("props.json"), load("drugs.json")
    return drugs_json, props_json


@app.cell
def _():
    # (tab label, QED's own name for the property, the column in the table, how to read it)
    TERMS = [
        ("Molecular weight", "MW", "MW", "daltons"),
        ("log P (Crippen)", "ALOGP", "ALOGP", "the octanol-water partition coefficient RDKit computes"),
        ("H-bond acceptors", "HBA", "HBA", "counted with QED's own SMARTS set, not the Lipinski N+O count"),
        ("H-bond donors", "HBD", "HBD", "NH and OH count"),
        ("Polar surface area", "PSA", "PSA", "topological PSA, square angstroms"),
        ("Rotatable bonds", "ROTB", "ROTB", "RDKit's strict definition, as QED counts them"),
        ("Aromatic rings", "AROM", "AROM", "as QED counts them, after deleting aliphatic rings"),
        ("Structural alerts", "ALERTS", "ALERTS", "Brenk-type alerting substructures matched"),
    ]
    return (TERMS,)


@app.cell
def _(TERMS, drugs_json, pd, props_json):
    # props.json is columnar: one list per property, aligned with its cids. drugs.json carries the ATC
    # codes with their modes of administration, the curated SMILES and the names.
    _props = pd.DataFrame(props_json["cols"], index=pd.Index(props_json["cids"], name="cid"))
    _atc1 = {k: v for k, v in drugs_json["meta"]["atc_names"].items() if len(k) == 1}
    _rows = []
    for _d in drugs_json["drugs"]:
        _routes = sorted({r for e in _d.get("atc", []) for r in (e.get("routes") or [])})
        _rows.append({
            "cid": _d["cid"],
            "Name": _d["name"].replace(".", " ").strip().capitalize(),
            "SMILES": _d["smiles"],
            "ATC group": "; ".join(sorted({_atc1.get(e["code"][0], e["code"][0]).capitalize()
                                           for e in _d.get("atc", [])})) or "unclassified",
            "ATC groups": sorted({_atc1.get(e["code"][0], e["code"][0]).capitalize()
                                  for e in _d.get("atc", [])}),
            "Routes": _routes,
            "Modes of administration": "; ".join(r.capitalize() for r in _routes) or "unspecified",
            # the four QED terms RDKit stores under their usual descriptor names in drugs.json
            "MW": (_d.get("d") or {}).get("mw"),
            "ALOGP": (_d.get("d") or {}).get("logp"),
            "HBD": (_d.get("d") or {}).get("hbd"),
            "PSA": (_d.get("d") or {}).get("tpsa"),
        })
    df = pd.DataFrame(_rows).set_index("cid").join(_props, how="inner")
    # the four QED counts that use QED's own definitions rather than the usual ones
    df = df.rename(columns={"qed": "QED", "qedmax": "QED (max weights)", "alerts": "ALERTS",
                            "rotbs": "ROTB", "hbaq": "HBA", "aromq": "AROM", "qlim": "Weakest term"})
    for _label, _term, _column, _ in TERMS:
        df[f"desirability {_term}"] = df[f"d{_term}"]
    df = df.reset_index().sort_values("Name", kind="stable")
    return (df,)


@app.cell(hide_code=True)
def _(df, mo):
    _groups = sorted({g for gs in df["ATC groups"] for g in gs})
    _routes = sorted({r for rs in df["Routes"] for r in rs})
    atc = mo.ui.multiselect(options=_groups, value=[], label="ATC group (anatomical main group)")
    route = mo.ui.multiselect(options=_routes, value=[], label="Mode of administration")
    bins = mo.ui.slider(start=8, stop=40, step=2, value=24, label="Histogram bins")
    mo.vstack([
        mo.md("### Filters\nLeave a filter empty to keep every drug. A drug licensed by more than one "
              "route appears under each of them, so the route filter selects *drugs administered that "
              "way*, and the counts across routes do not add up to the whole set."),
        mo.hstack([atc, route, bins], justify="start", gap=2),
    ])
    return atc, bins, route


@app.cell
def _(atc, df, route):
    sub = df
    if atc.value:
        _wanted = set(atc.value)
        sub = sub[[bool(_wanted & set(g)) for g in sub["ATC groups"]]]
    if route.value:
        _wanted_r = set(route.value)
        sub = sub[[bool(_wanted_r & set(r)) for r in sub["Routes"]]]
    sub = sub.copy()
    return (sub,)


@app.cell(hide_code=True)
def _(atc, df, mo, route, sub):
    mo.md(f"**{len(sub)} of {len(df)} drugs** pass the filters"
          + (f" (ATC: {', '.join(atc.value)})" if atc.value else "")
          + (f" (route: {', '.join(r.capitalize() for r in route.value)})" if route.value else "")
          + (". Median QED "
             f"{sub['QED'].median():.3f}, mean {sub['QED'].mean():.3f}." if len(sub) else
             ". Nothing to draw: widen the filters."))
    return


@app.cell
def _(QED, np, pd):
    def desirability_curve(term, low, high, n=240):
        """RDKit's own desirability function for one QED term, over the observed range of that term."""
        xs = np.linspace(float(low), float(high), n)
        params = QED.adsParameters[term]
        return pd.DataFrame({"x": xs, "desirability": [QED.ads(float(x), params) for x in xs]})
    return (desirability_curve,)


@app.cell
def _(TERMS, alt, bins, desirability_curve, mo, np, sub):
    CHART_WIDTH = 620

    def binned(column, bin_count):
        """Bin the property in pandas rather than in Vega.

        Two marimo/Vega-Lite facts drive this: an interval brush does not highlight Vega-binned bars,
        and a layered chart does not hand its underlying rows back, so the selection has to be applied
        to a frame we hold ourselves (`chart.apply_selection`). Binning here gives every drug a
        `bin_mid`, a plain quantitative column that both the bars and the brush can key on.
        """
        values = sub[column].astype(float)
        low, high = float(values.min()), float(values.max())
        if not (high > low):
            high = low + 1.0
        edges = np.linspace(low, high, bin_count + 1)
        mids = (edges[:-1] + edges[1:]) / 2.0
        index = np.clip(np.digitize(values, edges[1:-1]), 0, bin_count - 1)
        frame = sub.copy()
        frame["bin_mid"] = mids[index]
        frame["value"] = values.to_numpy()
        return frame, low, high, (high - low) / bin_count

    def panel(frame, column, term, low, high, width):
        """Histogram of one property with QED's desirability curve for it on the right-hand axis."""
        histogram = (
            alt.Chart(frame)
            .mark_bar(color="#6a9fc0", opacity=0.85, size=max(3.0, CHART_WIDTH / len(frame["bin_mid"].unique()) * 0.82)
                      if len(frame) else 6.0)
            .encode(
                x=alt.X("bin_mid:Q", title=column,
                        scale=alt.Scale(domain=[low - width / 2, high + width / 2], nice=False)),
                y=alt.Y("count()", title="drugs"),
                tooltip=[alt.Tooltip("bin_mid:Q", title=f"{column} (bin centre)", format=".3g"),
                         alt.Tooltip("count()", title="drugs")],
            )
        )
        if term is None:  # the composite score has no desirability curve of its own
            return histogram.properties(height=260, width=CHART_WIDTH)
        curve = (
            alt.Chart(desirability_curve(term, low, high))
            .mark_line(color="#b2182b", strokeWidth=2.5)
            .encode(
                x=alt.X("x:Q", title=column),
                y=alt.Y("desirability:Q", title="QED desirability", scale=alt.Scale(domain=[0, 1])),
                tooltip=[alt.Tooltip("x:Q", format=".2f"), alt.Tooltip("desirability:Q", format=".3f")],
            )
        )
        return (alt.layer(histogram, curve).resolve_scale(y="independent")
                .properties(height=260, width=CHART_WIDTH))

    charts, frames = {}, {}
    if len(sub):
        for _label, _term, _column in ([("QED", None, "QED")]
                                       + [(l, t, c) for l, t, c, _ in TERMS]):
            _frame, _low, _high, _width = binned(_column, bins.value)
            frames[_label] = _frame
            charts[_label] = mo.ui.altair_chart(
                panel(_frame, _column, _term, _low, _high, _width), chart_selection="interval")
    return charts, frames


@app.cell
def _(Draw, mcu, mo, pd, uru):
    def molecule_grid(selection, value_column, max_to_show=24):
        """The selected molecules, drawn with marimo_chem_utils when it imported and RDKit when not."""
        if selection is None or not len(selection):
            return mo.md("*Brush the histogram above to draw the molecules in those bins.*")
        frame = selection.copy()
        frame = frame.sort_values(value_column, kind="stable").head(max_to_show)
        frame["Label"] = (frame["Name"].astype(str) + "  "
                          + pd.to_numeric(frame[value_column], errors="coerce").round(2).astype(str))
        if mcu is not None:
            try:
                return mcu.draw_molecule_grid(frame, legend_column="Label", num_cols=4,
                                              max_to_show=max_to_show)
            except Exception:
                pass
        from rdkit import Chem as _Chem
        mols = [_Chem.MolFromSmiles(s) for s in frame["SMILES"]]
        pairs = [(m, str(l)) for m, l in zip(mols, frame["Label"]) if m is not None]
        if not pairs:
            return mo.md("*No drawable structure in this selection.*")
        return Draw.MolsToGridImage([m for m, _ in pairs], legends=[l for _, l in pairs],
                                    molsPerRow=4, subImgSize=(200, 200))

    def scaffold_table(selection, value_column, limit=12):
        """Murcko scaffolds of the selection, from useful_rdkit_utils when it imported."""
        if selection is None or not len(selection) or uru is None:
            return None
        try:
            frame = selection.copy()
            frame["Murcko scaffold"] = [uru.MurckoScaffoldSmiles(s) for s in frame["SMILES"]]
            counts = (frame.groupby("Murcko scaffold")[value_column]
                      .agg(["count", "median"]).sort_values("count", ascending=False).head(limit)
                      .reset_index().rename(columns={"count": "drugs", "median": f"median {value_column}"}))
            return mo.ui.table(counts, selection=None, label="Murcko scaffolds in the brushed bins "
                                                             "(useful_rdkit_utils)")
        except Exception:
            return None
    return molecule_grid, scaffold_table


@app.cell(hide_code=True)
def _(TERMS, charts, frames, mo, molecule_grid, scaffold_table, sub):
    def brushed(label):
        """The rows inside the brush, or None when nothing (or everything) is selected.

        A layered marimo chart does not expose its underlying rows, so the selection is applied to the
        frame the chart was built from. With no brush `apply_selection` hands back every row, which is
        indistinguishable from brushing the whole axis, so both are treated as 'no selection'.
        """
        chart, frame = charts.get(label), frames.get(label)
        if chart is None or frame is None:
            return None
        try:
            rows = chart.apply_selection(frame)
        except Exception:
            return None
        if rows is None or not hasattr(rows, "__len__") or not len(rows) or len(rows) >= len(frame):
            return None
        return rows

    def tab(label, column, term, how):
        chart = charts[label]
        selection = brushed(label)
        header = (f"**{label}** - {how}."
                  + (f" QED's desirability for this property is the red curve; the stored value for each "
                     f"drug is in `desirability {term}`." if term else
                     " The composite score itself: the weighted geometric mean of the eight "
                     "desirabilities, so it has no desirability curve of its own."))
        median = sub[column].median() if len(sub) else float("nan")
        stats = (f"median {median:.3f} over the {len(sub)} filtered drugs"
                 + (f"; mean desirability {sub[f'desirability {term}'].mean():.3f}" if term else ""))
        parts = [mo.md(header + "  \n" + stats), chart,
                 mo.md(f"**{len(selection)} drugs brushed.**" if selection is not None
                       else "*Drag across the bars to pick bins; those molecules are drawn below.*"),
                 molecule_grid(selection, column)]
        extra = scaffold_table(selection, column)
        if extra is not None:
            parts.append(extra)
        return mo.vstack(parts)

    if charts:
        _panels = {"QED": tab("QED", "QED", None, "RDKit's quantitative estimate of drug-likeness, "
                                                  "0 to 1, mean weights")}
        for _label, _term, _column, _how in TERMS:
            _panels[_label] = tab(_label, _column, _term, _how)
        _view = mo.ui.tabs(_panels)
    else:
        _view = mo.md("**No drug passes the filters.** Widen them to draw anything.")
    _view
    return


@app.cell(hide_code=True)
def _(TERMS, mo, sub):
    _cols = ["Name", "ATC group", "Modes of administration", "QED", "QED (max weights)",
             "Weakest term"] + [c for _, _, c, _ in [("", t, c, "") for _, t, c, _ in TERMS]
                                for c in [c]] + [f"desirability {t}" for _, t, _, _ in TERMS]
    mo.vstack([
        mo.md("### Every filtered drug\nThe composite score, the eight properties and the eight "
              "desirabilities behind it. `Weakest term` is the property whose desirability is lowest for "
              "that drug, which is the one holding its QED down."),
        mo.ui.table(sub[[c for c in _cols if c in sub.columns]].round(3), selection=None,
                    page_size=15),
    ])
    return


@app.cell(hide_code=True)
def _(mo, mols2grid, sub):
    # mols2grid renders its own interactive, searchable grid; it is kept in a panel of its own so that a
    # failure here cannot take the rest of the notebook down.
    def interactive_grid():
        if mols2grid is None:
            return mo.md("*`mols2grid` did not import, so this panel is empty; the per-bin grids above "
                         "use `marimo_chem_utils` or plain RDKit drawing instead.*")
        if not len(sub):
            return mo.md("*No drug passes the filters.*")
        try:
            frame = sub.head(200)[["SMILES", "Name", "QED", "ALERTS"]].copy()
            html = mols2grid.display(frame, smiles_col="SMILES", subset=["img", "Name", "QED"],
                                     tooltip=["Name", "QED", "ALERTS"], n_cols=5, size=(170, 150))
            return mo.iframe(getattr(html, "data", str(html)), height="520px")
        except Exception as error:
            return mo.md(f"*`mols2grid` raised `{type(error).__name__}: {error}`, so this panel is "
                         "empty; the per-bin grids above are unaffected.*")

    mo.vstack([mo.md("### mols2grid: the filtered set, searchable\nThe first 200 filtered drugs, sorted "
                     "by name."), interactive_grid()])
    return


if __name__ == "__main__":
    app.run()
