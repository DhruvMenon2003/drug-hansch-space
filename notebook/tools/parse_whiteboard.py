"""Parse an .excalidraw scene into the workflow it draws.

Excalidraw stores a flat list of elements. The structure a reader sees comes from four
relations that are not in the element order: a text element bound to a container
(`containerId`), an arrow bound to two shapes (`startBinding`/`endBinding`), elements
grouped together (`groupIds`), and elements belonging to a frame (`frameId`). This reads
those relations back out and writes the graph, so the pipeline can be followed card by
card rather than guessed at from coordinates.

Usage:
    python3 parse_whiteboard.py SCENE.excalidraw OUT_DIR
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

SHAPE_TYPES = {"rectangle", "ellipse", "diamond", "image", "frame"}


def load(path: Path) -> list[dict]:
    scene = json.loads(path.read_text())
    return [e for e in scene.get("elements", []) if not e.get("isDeleted")]


def clean(text: str) -> str:
    """Collapse the newlines Excalidraw inserts for visual wrapping."""
    return re.sub(r"\s+", " ", (text or "").replace(" ", " ")).strip()


def build(elements: list[dict]) -> dict:
    by_id = {e["id"]: e for e in elements}
    labels: dict[str, list[str]] = defaultdict(list)
    loose: list[dict] = []

    for e in elements:
        if e["type"] != "text":
            continue
        holder = e.get("containerId")
        if holder and holder in by_id:
            labels[holder].append(clean(e.get("text", "")))
        else:
            loose.append(e)

    # A text element with no container still labels the shape it sits inside.
    for t in loose:
        tx, ty = t.get("x", 0), t.get("y", 0)
        best = None
        for e in elements:
            if e["type"] not in SHAPE_TYPES or e["type"] == "frame":
                continue
            x, y = e.get("x", 0), e.get("y", 0)
            w, h = e.get("width", 0), e.get("height", 0)
            if x <= tx <= x + w and y <= ty <= y + h:
                area = max(w * h, 1)
                if best is None or area < best[1]:
                    best = (e["id"], area)
        if best:
            labels[best[0]].append(clean(t.get("text", "")))
        else:
            labels.setdefault("__floating__", []).append(clean(t.get("text", "")))

    nodes = {}
    for e in elements:
        if e["type"] not in SHAPE_TYPES:
            continue
        nodes[e["id"]] = {
            "id": e["id"],
            "type": e["type"],
            "x": round(e.get("x", 0), 1),
            "y": round(e.get("y", 0), 1),
            "w": round(e.get("width", 0), 1),
            "h": round(e.get("height", 0), 1),
            "frame": e.get("frameId"),
            "groups": e.get("groupIds") or [],
            "label": " / ".join(p for p in labels.get(e["id"], []) if p),
        }

    edges = []
    for e in elements:
        if e["type"] != "arrow":
            continue
        s = (e.get("startBinding") or {}).get("elementId")
        t = (e.get("endBinding") or {}).get("elementId")
        edges.append({
            "id": e["id"],
            "from": s,
            "to": t,
            "label": " / ".join(labels.get(e["id"], [])),
            "x": round(e.get("x", 0), 1),
            "y": round(e.get("y", 0), 1),
        })

    return {
        "nodes": nodes,
        "edges": edges,
        "floating_text": labels.get("__floating__", []),
        "counts": dict(Counter(e["type"] for e in elements)),
    }


def reading_order(graph: dict) -> list[dict]:
    """Left-to-right, top-to-bottom within bands, which is how the board is drawn."""
    cards = [n for n in graph["nodes"].values() if n["type"] != "frame" and n["label"]]
    band = 220.0
    cards.sort(key=lambda n: (round(n["y"] / band), n["x"]))
    return cards


def main() -> None:
    scene_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    elements = load(scene_path)
    graph = build(elements)
    graph["source"] = scene_path.name
    (out_dir / "whiteboard_graph.json").write_text(json.dumps(graph, indent=1))

    cards = reading_order(graph)
    lines = [f"{i + 1}\t{c['type']}\t({c['x']:.0f},{c['y']:.0f})\t{c['label']}"
             for i, c in enumerate(cards)]
    (out_dir / "whiteboard_cards.tsv").write_text("\n".join(lines) + "\n")

    named = {n["id"]: n["label"] for n in graph["nodes"].values() if n["label"]}
    arrows = [f"{named.get(e['from'], '?')}\t->\t{named.get(e['to'], '?')}\t{e['label']}"
              for e in graph["edges"] if e["from"] or e["to"]]
    (out_dir / "whiteboard_arrows.tsv").write_text("\n".join(arrows) + "\n")

    print(f"{len(elements)} elements, {len(graph['nodes'])} shapes, "
          f"{len(cards)} labelled cards, {len(graph['edges'])} arrows "
          f"({len(arrows)} bound), {len(graph['floating_text'])} floating texts")
    print(f"wrote {out_dir}/whiteboard_graph.json, whiteboard_cards.tsv, whiteboard_arrows.tsv")


if __name__ == "__main__":
    main()
