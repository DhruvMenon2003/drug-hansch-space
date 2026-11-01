"""The two figures the board asks for, generated from the data rather than drawn.

One layout model, two renderers: an `.excalidraw` scene that opens in the same editor the
board came from, and a matplotlib figure so the notebook can show it inline without any
external renderer. Both read the same `Diagram`, so the picture in the notebook and the
file handed back cannot drift apart.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

PALETTE = {
    "experimental": {"bg": "#e7f5e9", "stroke": "#2f7a3f"},
    "computed":     {"bg": "#eaf0fb", "stroke": "#2f5d9e"},
    "annotation":   {"bg": "#f6f1e7", "stroke": "#8a6d2f"},
    "derived":      {"bg": "#f7e9f2", "stroke": "#8e3a6b"},
    "step":         {"bg": "#f2f3f5", "stroke": "#4a4f57"},
}


@dataclass
class Box:
    key: str
    label: str
    kind: str
    x: float
    y: float
    w: float = 280.0
    h: float = 68.0
    note: str = ""


@dataclass
class Edge:
    a: str
    b: str
    label: str = ""


@dataclass
class Diagram:
    title: str
    boxes: list[Box] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)

    def box(self, key: str) -> Box:
        return next(b for b in self.boxes if b.key == key)


def schema_diagram(columns: list[tuple[str, str, str]], title: str) -> Diagram:
    """columns: (name, kind, note). Laid out in kind-blocks, as the board draws the schema."""
    order = ["annotation", "experimental", "computed", "derived"]
    d = Diagram(title=title)
    groups: dict[str, list[tuple[str, str, str]]] = {k: [] for k in order}
    for name, kind, note in columns:
        groups.setdefault(kind, []).append((name, kind, note))
    x = 40.0
    for kind in order:
        rows = groups.get(kind) or []
        if not rows:
            continue
        y = 110.0
        for name, _, note in rows:
            d.boxes.append(Box(f"{kind}:{name}", name, kind, x, y, 260, 56, note))
            y += 70
        d.boxes.append(Box(f"hdr:{kind}", kind.upper(), kind, x, 30.0, 260, 48))
        x += 300
    return d


def workflow_diagram(steps: list[tuple[str, str, str]], title: str) -> Diagram:
    """steps: (section, label, board stage). One column, top to bottom, arrows between."""
    d = Diagram(title=title)
    y = 30.0
    for section, label, stage in steps:
        d.boxes.append(Box(section, f"{section}  {label}", "step", 40.0, y, 460, 60,
                           f"board stage {stage}"))
        y += 86
    for a, b in zip(d.boxes, d.boxes[1:]):
        d.edges.append(Edge(a.key, b.key))
    return d


# ---------------------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------------------

def _el(i: int, **kw) -> dict:
    base = {"id": f"el{i}", "angle": 0, "strokeWidth": 1.5, "strokeStyle": "solid",
            "fillStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [],
            "frameId": None, "roundness": {"type": 3}, "seed": 1000 + i, "version": 1,
            "versionNonce": 1, "isDeleted": False, "boundElements": None,
            "updated": 1, "link": None, "locked": False}
    base.update(kw)
    return base


def to_excalidraw(d: Diagram) -> dict:
    els: list[dict] = []
    i = 0
    ids: dict[str, str] = {}
    for b in d.boxes:
        c = PALETTE.get(b.kind, PALETTE["step"])
        i += 1
        ids[b.key] = f"el{i}"
        els.append(_el(i, type="rectangle", x=b.x, y=b.y, width=b.w, height=b.h,
                       strokeColor=c["stroke"], backgroundColor=c["bg"]))
        i += 1
        text = b.label + (f"\n{b.note}" if b.note else "")
        els.append(_el(i, type="text", x=b.x + 12, y=b.y + 12, width=b.w - 24,
                       height=b.h - 24, strokeColor=c["stroke"],
                       backgroundColor="transparent", text=text, fontSize=16,
                       fontFamily=1, textAlign="left", verticalAlign="top",
                       originalText=text, lineHeight=1.25, roundness=None))
    for e in d.edges:
        a, b = d.box(e.a), d.box(e.b)
        i += 1
        els.append(_el(i, type="arrow", x=a.x + a.w / 2, y=a.y + a.h,
                       width=(b.x + b.w / 2) - (a.x + a.w / 2), height=b.y - (a.y + a.h),
                       strokeColor="#4a4f57", backgroundColor="transparent",
                       points=[[0, 0], [(b.x + b.w / 2) - (a.x + a.w / 2), b.y - (a.y + a.h)]],
                       startBinding={"elementId": ids[e.a], "focus": 0, "gap": 4},
                       endBinding={"elementId": ids[e.b], "focus": 0, "gap": 4},
                       startArrowhead=None, endArrowhead="arrow", roundness={"type": 2}))
    return {"type": "excalidraw", "version": 2,
            "source": "drug-hansch-space/notebook/tools/schematics.py",
            "elements": els, "appState": {"viewBackgroundColor": "#ffffff",
                                          "gridSize": None}, "files": {}}


def write_excalidraw(d: Diagram, path) -> str:
    text = json.dumps(to_excalidraw(d), indent=1)
    with open(path, "w") as fh:
        fh.write(text)
    return text


def render(d: Diagram, ax=None, scale: float = 1 / 90):
    """Draw the same Diagram with matplotlib, for display where no editor is available."""
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

    xs = [b.x + b.w for b in d.boxes] or [600]
    ys = [b.y + b.h for b in d.boxes] or [400]
    if ax is None:
        _, ax = plt.subplots(figsize=(max(xs) * scale, max(ys) * scale))
    for b in d.boxes:
        c = PALETTE.get(b.kind, PALETTE["step"])
        ax.add_patch(FancyBboxPatch((b.x, -b.y - b.h), b.w, b.h,
                                    boxstyle="round,pad=2,rounding_size=8",
                                    linewidth=1.4, edgecolor=c["stroke"],
                                    facecolor=c["bg"]))
        ax.text(b.x + 12, -b.y - 22, b.label, fontsize=9, color=c["stroke"],
                va="center", ha="left", fontweight="bold")
        if b.note:
            ax.text(b.x + 12, -b.y - 42, b.note, fontsize=7.5, color=c["stroke"],
                    va="center", ha="left", alpha=0.85)
    for e in d.edges:
        a, b = d.box(e.a), d.box(e.b)
        ax.add_patch(FancyArrowPatch((a.x + a.w / 2, -a.y - a.h),
                                     (b.x + b.w / 2, -b.y),
                                     arrowstyle="-|>", mutation_scale=11,
                                     linewidth=1.1, color="#4a4f57"))
    ax.set_xlim(0, max(xs) + 40)
    ax.set_ylim(-max(ys) - 40, 0)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(d.title, fontsize=11, loc="left")
    return ax
