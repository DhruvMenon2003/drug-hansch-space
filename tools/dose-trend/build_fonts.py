"""Prepare the fonts that the PDF export embeds: data/pdf_fonts.json.

Nature's figure guide asks for editable text in a standard face with the fonts embedded as TrueType (Type 42),
never Type 3. Arial cannot be redistributed, so the PDF carries Arimo, which has Arial's widths and is under the
SIL Open Font License. Each of the four styles is cut down to the characters a figure label can use, stored
deflated, and dropped into the PDF as it is (a FontFile2 stream with /Filter /FlateDecode).

Usage: python3 -I build_fonts.py /path/to/@expo-google-fonts/arimo
"""
import base64, io, json, sys, zlib
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

src = Path(sys.argv[1]); out = Path(__file__).resolve().parent / "data/pdf_fonts.json"
STYLES = [("regular", "400Regular/Arimo_400Regular.ttf"), ("bold", "700Bold/Arimo_700Bold.ttf"),
          ("italic", "400Regular_Italic/Arimo_400Regular_Italic.ttf"), ("boldItalic", "700Bold_Italic/Arimo_700Bold_Italic.ttf")]

# Windows-1252, which the PDF uses as the base encoding, plus the mathematics and Greek a label may need.
winansi = [c for c in range(0x20, 0x7F)] + [ord(bytes([b]).decode("cp1252")) for b in range(0x80, 0x100) if b not in (0x81, 0x8D, 0x8F, 0x90, 0x9D)]
extra = [ord(c) for c in "−≤≥≠≈→←↑↓↔∞√∑∏∆∂∫′″‴⁰⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉½¼¾"] + list(range(0x0391, 0x03AA)) + list(range(0x03B1, 0x03CA))
wanted = sorted(set(winansi + extra))

fonts = {}
for key, rel in STYLES:
    opt = subset.Options()
    opt.hinting = False; opt.layout_features = []; opt.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]; opt.name_languages = [0x409]
    opt.notdef_outline = True; opt.glyph_names = False; opt.legacy_cmap = False; opt.symbol_cmap = False; opt.prune_unicode_ranges = True
    opt.drop_tables += ["GDEF", "GPOS", "GSUB", "STAT", "gasp", "DSIG", "prep", "fpgm", "cvt "]
    font = TTFont(src / rel)
    full = font.getBestCmap()
    missing = [hex(u) for u in wanted if u not in full]
    sub = subset.Subsetter(opt); sub.populate(unicodes=[u for u in wanted if u in full]); sub.subset(font)
    buf = io.BytesIO(); font.save(buf); raw = buf.getvalue()
    font = TTFont(io.BytesIO(raw))  # read back what will be embedded
    upm = font["head"].unitsPerEm; k = 1000 / upm; cmap = font.getBestCmap(); hmtx = font["hmtx"]; os2 = font["OS/2"]; head = font["head"]
    assert "glyf" in font and any(t.platformID == 3 and t.platEncID == 1 for t in font["cmap"].tables), "needs TrueType outlines and a (3,1) cmap"
    fonts[key] = {
        "name": font["name"].getDebugName(6),
        "widths": {str(u): round(hmtx[g][0] * k) for u, g in sorted(cmap.items())},
        "bbox": [round(v * k) for v in (head.xMin, head.yMin, head.xMax, head.yMax)],
        "ascent": round(os2.sTypoAscender * k), "descent": round(os2.sTypoDescender * k), "capHeight": round(os2.sCapHeight * k),
        "italicAngle": font["post"].italicAngle, "stemV": 140 if "bold" in key.lower() else 80,
        "length1": len(raw), "data": base64.b64encode(zlib.compress(raw, 9)).decode(),
    }
    print(f"{key:11s} {fonts[key]['name']:18s} {len(cmap)} characters, {len(raw):,} bytes, {len(zlib.compress(raw, 9)):,} deflated", ("missing " + ",".join(missing)) if missing else "")

meta = {"family": "Arimo", "licence": "SIL Open Font License 1.1", "copyright": TTFont(src / STYLES[0][1])["name"].getDebugName(0)}
out.write_text(json.dumps({"meta": meta, "fonts": fonts}, separators=(",", ":")), encoding="utf-8")
print("wrote", out, f"{out.stat().st_size:,} bytes")

# Layout is done with Helvetica's published widths. Arimo should agree for everything on a keyboard.
HELV = {" ": 278, "a": 556, "f": 278, "r": 333, "@": 1015, "W": 944, "0": 556, ".": 278, "(": 333, "%": 889, "P": 667, "=": 584, "m": 833}
diff = {c: (w, fonts["regular"]["widths"][str(ord(c))]) for c, w in HELV.items() if fonts["regular"]["widths"][str(ord(c))] != w}
print("spot check against Helvetica widths:", "identical" if not diff else diff)
