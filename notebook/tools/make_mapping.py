"""Generate the whiteboard-to-notebook mapping from the parsed graph and the section reading.

Fails if any labelled card on the board is unassigned or assigned twice, so the mapping
cannot silently drop part of the board.

Usage:
    python3 make_mapping.py WB_DIR SCENE OUT_MD OUT_EXCALIDRAW
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from whiteboard_sections import CELL_IDS, STAGES  # noqa: E402


def read_cards(wb_dir: Path) -> list[dict]:
    rows = []
    for line in (wb_dir / "whiteboard_cards.tsv").read_text().splitlines():
        if not line.strip():
            continue
        n, kind, pos, *label = line.split("\t")
        rows.append({"n": int(n), "type": kind, "pos": pos, "label": "\t".join(label)})
    return rows


def check(cards: list[dict]) -> None:
    assigned: dict[int, str] = {}
    for stage in STAGES:
        for n in stage["cards"]:
            if n in assigned:
                raise SystemExit(f"card {n} is in both {assigned[n]} and {stage['key']}")
            assigned[n] = stage["key"]
    every = {c["n"] for c in cards}
    missing = sorted(every - set(assigned))
    unknown = sorted(set(assigned) - every)
    if unknown:
        raise SystemExit(f"sections name cards that are not on the board: {unknown}")
    if missing:
        raise SystemExit(f"{len(missing)} labelled cards are in no stage: {missing}")


def short(label: str, width: int = 110) -> str:
    label = label.replace("|", "\\|")
    return label if len(label) <= width else label[: width - 1] + "…"


def mermaid() -> str:
    lines = ["flowchart TD"]
    for stage in STAGES:
        if stage["implemented_by"] is None:
            continue
        key = stage["key"]
        lines.append(f'  {key}["{stage["title"]}"]')
    chain = [s["key"] for s in STAGES if s["implemented_by"] is not None]
    for a, b in zip(chain, chain[1:]):
        lines.append(f"  {a} --> {b}")
    return "\n".join(lines)


def excalidraw_export() -> dict:
    """A re-openable board of the mapping itself, one card per implemented stage."""
    elements = []
    y = 0
    for i, stage in enumerate(STAGES):
        if stage["implemented_by"] is None:
            continue
        box_id = f"map-{i}"
        elements.append({
            "id": box_id, "type": "rectangle", "x": 0, "y": y, "width": 620, "height": 110,
            "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "#e7f5ff",
            "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1,
            "opacity": 100, "groupIds": [], "frameId": None, "roundness": {"type": 3},
            "seed": 1000 + i, "version": 1, "versionNonce": 1, "isDeleted": False,
            "boundElements": [{"id": f"map-{i}-t", "type": "text"}], "updated": 1, "link": None,
            "locked": False,
        })
        cells = ", ".join(CELL_IDS.get(k, k) for k in (stage["implemented_by"] or "").split(","))
        elements.append({
            "id": f"map-{i}-t", "type": "text", "x": 12, "y": y + 12, "width": 596,
            "height": 86, "angle": 0, "strokeColor": "#1e1e1e",
            "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2,
            "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [],
            "frameId": None, "roundness": None, "seed": 2000 + i, "version": 1,
            "versionNonce": 1, "isDeleted": False, "boundElements": [], "updated": 1,
            "link": None, "locked": False,
            "text": f"{stage['title']}\n{cells}", "fontSize": 16, "fontFamily": 1,
            "textAlign": "left", "verticalAlign": "top", "containerId": box_id,
            "originalText": f"{stage['title']}\n{cells}", "lineHeight": 1.25,
        })
        y += 150
    return {
        "type": "excalidraw", "version": 2, "source": "drug-hansch-space/notebook",
        "elements": elements, "appState": {"viewBackgroundColor": "#ffffff"}, "files": {},
    }


def main() -> None:
    wb_dir, scene, out_md, out_ex = (Path(a) for a in sys.argv[1:5])
    cards = read_cards(wb_dir)
    check(cards)
    by_n = {c["n"]: c for c in cards}
    graph = json.loads((wb_dir / "whiteboard_graph.json").read_text())
    digest = hashlib.sha256(scene.read_bytes()).hexdigest()

    out = [
        "# Whiteboard → notebook mapping",
        "",
        f"Scene file: `{scene.name}`  ",
        f"SHA-256: `{digest}`  ",
        f"Elements: {sum(graph['counts'].values())} "
        + ", ".join(f"{v} {k}" for k, v in sorted(graph["counts"].items())),
        "",
        "The board was parsed, not eyeballed: `tools/parse_whiteboard.py` reads the element",
        "list and rebuilds the four relations that carry the structure — text bound to a",
        "container, arrows bound to two shapes, group membership and frame membership — then",
        "writes the graph and a card list in reading order. `tools/whiteboard_sections.py`",
        "holds the one interpretive step, and `tools/make_mapping.py` refuses to generate this",
        f"file unless all {len(cards)} labelled cards are assigned to exactly one stage.",
        "",
        "```mermaid",
        mermaid(),
        "```",
        "",
    ]

    for stage in STAGES:
        out.append(f"## {stage['title']}")
        out.append("")
        out.append(stage["reading"])
        out.append("")
        if stage["implemented_by"] is None:
            out.append(f"**Not implemented.** {stage['reason_out_of_scope']}")
        else:
            cells = [CELL_IDS.get(k, k) for k in stage["implemented_by"].split(",")]
            out.append("**Implemented by:** " + "; ".join(cells))
        out.append("")
        out.append("| Card | Shape | Position | Label on the board |")
        out.append("| ---: | --- | --- | --- |")
        for n in stage["cards"]:
            c = by_n[n]
            out.append(f"| {n} | {c['type']} | {c['pos']} | {short(c['label'])} |")
        out.append("")

    out_md.write_text("\n".join(out))
    out_ex.write_text(json.dumps(excalidraw_export(), indent=1))
    print(f"all {len(cards)} labelled cards assigned across {len(STAGES)} stages")
    print(f"wrote {out_md} and {out_ex}")


if __name__ == "__main__":
    main()
