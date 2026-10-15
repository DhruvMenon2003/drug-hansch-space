#!/usr/bin/env python3
"""Build the binding scenes for Drug Hansch Space (the "watch it bind" movie in the 3D view).

One scene per ChEMBL mechanism target that has a Hansch fit group. Every coordinate in a scene is measured, not
invented: the receptor and the bound ligand come from a real PDB entry for that target's UniProt protein, and a
group member that is not the crystallised ligand gets a pose by aligning its RDKit conformer onto the crystal
ligand over their maximum common substructure. That is an alignment, not a docking run, and each pose carries the
number of matched atoms and the alignment RMSD so the viewer can see how much to trust it.

    python3 tools/build_binding.py                      # every group in site/data/hansch.json, plus --extra targets
    python3 tools/build_binding.py --only CHEMBL1941    # one target
    python3 tools/build_binding.py --pdb CHEMBL1941=7UL4  # force the entry to use

Writes site/data/binding/<CHEMBL id>.json, site/data/binding/index.json and appends to site/data/provenance.csv.

APIs used (no scraping):
    ChEMBL      /chembl/api/data/target/<id>.json          UniProt accession and the target's preferred name
    PDBe SIFTS  /pdbe/api/mappings/best_structures/<acc>   the entries that cover that protein, best first
    RCSB        /rest/v1/core/entry/<id>                   title, method, resolution, which ligands are bound
    RCSB        /rest/v1/core/chemcomp/<comp>              the ligand's name, SMILES and InChIKey
    RCSB files  /download/<id>.pdb                         the coordinates themselves
"""
import argparse, csv, datetime as dt, hashlib, json, math, os, re, sys, time
from collections import defaultdict

import numpy as np
import requests
from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, rdFMCS, rdMolAlign, rdMolDescriptors

RDLogger.DisableLog("rdApp.*")

CHEMBL = "https://www.ebi.ac.uk/chembl/api/data/target/{}.json"
SIFTS = "https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/{}"
RCSB_ENTRY = "https://data.rcsb.org/rest/v1/core/entry/{}"
RCSB_COMP = "https://data.rcsb.org/rest/v1/core/chemcomp/{}"
RCSB_PDB = "https://files.rcsb.org/download/{}.pdb"

POCKET_R = 10.0          # angstrom: a protein residue is in the pocket when any heavy atom is this close to the ligand
HB_R = 3.5               # N/O/F/S pair distance counted as a hydrogen bond (heavy-atom donor-acceptor distance)
HPHOB_R = 4.2            # carbon-carbon contact distance counted as hydrophobic
TRACE_MAX = 260          # CA points kept for the ribbon, decimated evenly
MCS_MIN = 6              # fewest matched heavy atoms that may carry a modelled pose
N_CONF = 24              # conformers embedded per member before the best alignment is chosen
SEED = 20261009

# Residues that are solvent, cryoprotectant, buffer, lipid or ion rather than the molecule the protein binds.
JUNK = {
    "HOH", "DOD", "WAT", "SO4", "PO4", "CL", "NA", "K", "MG", "CA", "ZN", "MN", "FE", "FE2", "CU", "NI", "CD", "HG",
    "BR", "IOD", "F", "NO3", "ACT", "ACY", "EDO", "PEG", "PG4", "PGE", "P6G", "1PE", "2PE", "TRS", "MES", "EPE",
    "GOL", "MPD", "DMS", "IMD", "FMT", "CIT", "TLA", "MLI", "SCN", "AZI", "NH4", "BME", "DTT", "TCE", "BOG", "LDA",
    "OLC", "OLA", "PLM", "MYR", "STE", "CPS", "CHD", "CLR", "C8E", "LMT", "DD9", "D10", "D12", "UNL", "UNX", "UNK",
    "NAG", "NDG", "BMA", "MAN", "GAL", "GLC", "FUC", "XYP", "SIA", "SUC", "BGC", "A2G",
}
# Cofactors: real molecules, but not what a drug series competes with unless nothing else is bound.
COFACTOR = {"NAD", "NAP", "NDP", "NAI", "FAD", "FMN", "ATP", "ADP", "AMP", "GTP", "GDP", "GNP", "ANP", "ACP",
            "SAM", "SAH", "COA", "ACO", "HEM", "HEC", "PLP", "TPP", "UDP", "UMP", "CMP", "IHP", "BTN"}
Z = {"H": 1, "C": 6, "N": 7, "O": 8, "F": 9, "NA": 11, "MG": 12, "SI": 14, "P": 15, "S": 16, "CL": 17, "K": 19,
     "CA": 20, "MN": 25, "FE": 26, "CO": 27, "NI": 28, "CU": 29, "ZN": 30, "AS": 33, "SE": 34, "BR": 35, "I": 53,
     "RU": 44, "PT": 78, "AU": 79, "GD": 64, "TC": 43, "B": 5, "LI": 3, "AL": 13, "BI": 83, "SB": 51, "SR": 38}
POLAR = {"ASP", "GLU", "LYS", "ARG", "HIS", "ASN", "GLN", "SER", "THR", "TYR", "TRP", "CYS"}
CHARGED = {"ASP", "GLU", "LYS", "ARG", "HIS"}


# ---------------------------------------------------------------- HTTP with a disk cache and a provenance log
class Http:
    def __init__(self, cache_dir):
        self.cache_dir, self.log, self.last = cache_dir, [], 0.0
        os.makedirs(cache_dir, exist_ok=True)
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "drug-hansch-space binding scenes (research; github.com/DhruvMenon2003)"

    def get(self, url, binary=False):
        """Return (status, text). 404 is a normal answer and is cached too."""
        path = os.path.join(self.cache_dir, hashlib.sha1(url.encode()).hexdigest() + (".txt" if binary else ".json"))
        if os.path.exists(path):
            c = json.load(open(path, encoding="utf-8"))
            self.log.append({"url": url, "status": c["status"], "bytes": len(c["text"]), "utc": c["utc"], "cached": True})
            return c["status"], c["text"]
        status, text = None, ""
        for attempt in range(4):
            gap = 0.25 - (time.monotonic() - self.last)
            if gap > 0:
                time.sleep(gap)
            self.last = time.monotonic()
            try:
                r = self.s.get(url, timeout=180)
                status, text = r.status_code, r.text
            except requests.RequestException as e:
                status, text = None, str(e)
            if status in (200, 404):
                break
            time.sleep(min(30, 2 ** (attempt + 1)))
        utc = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        self.log.append({"url": url, "status": status, "bytes": len(text), "utc": utc, "cached": False})
        if status in (200, 404):
            json.dump({"status": status, "text": text, "utc": utc}, open(path, "w", encoding="utf-8"))
        return status, text

    def json(self, url):
        st, tx = self.get(url)
        if st != 200:
            return None
        try:
            return json.loads(tx)
        except ValueError:
            return None


# ---------------------------------------------------------------- PDB parsing
def parse_pdb(text):
    """ATOM/HETATM records as two lists of dicts (protein/nucleic residues, and everything else), heavy atoms only.
    The first alternate location wins; hydrogens and deuteriums are dropped (most entries have none anyway)."""
    prot, het, seen_alt = [], [], {}
    for line in text.splitlines():
        rec = line[:6]
        if rec not in ("ATOM  ", "HETATM"):
            if rec == "ENDMDL":
                break                      # NMR and cryo-EM ensembles: the first model only
            continue
        name, alt, resn = line[12:16].strip(), line[16], line[17:20].strip()
        chain, resi, ins = line[21], line[22:26].strip(), line[26]
        el = (line[76:78].strip() or re.sub(r"[^A-Za-z]", "", name)[:1]).upper()
        if el in ("H", "D"):
            continue
        key = (chain, resi, ins, resn, name)
        if alt not in (" ", ""):
            if seen_alt.get(key):
                continue
            seen_alt[key] = True
        try:
            xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
        except ValueError:
            continue
        a = {"name": name, "resn": resn, "chain": chain, "resi": resi + ins.strip(), "el": el, "xyz": xyz,
             "z": Z.get(el, 6), "rec": rec.strip()}
        (prot if rec == "ATOM  " else het).append(a)
    return prot, het


def ligand_instances(het):
    """Candidate bound molecules: {(comp, chain, resi): [atoms]}, biggest first, junk removed."""
    groups = defaultdict(list)
    for a in het:
        if a["resn"] in JUNK:
            continue
        groups[(a["resn"], a["chain"], a["resi"])].append(a)
    return sorted(groups.items(), key=lambda kv: -len(kv[1]))


# ---------------------------------------------------------------- geometry
def centroid(xyz):
    return np.asarray(xyz, float).mean(axis=0)


def approach_vector(lig_xyz, prot_xyz):
    """The direction a ligand can reach the site from: of 482 evenly spread directions, the one whose 6 angstrom
    cylinder out to 26 angstrom from the site holds the fewest protein atoms. It is the least obstructed line of
    approach in this structure, which is a geometric statement about the crystal, not a computed binding path."""
    c = centroid(lig_xyz)
    P = np.asarray(prot_xyz, float) - c
    near = P[np.linalg.norm(P, axis=1) < 30.0]
    best, best_n = np.array([0.0, 0.0, 1.0]), None
    # Fibonacci sphere
    n = 482
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    dirs = np.stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)], axis=1)
    if not len(near):
        return best, 0
    proj = near @ dirs.T                                            # (atoms, dirs) distance along each direction
    perp2 = (near ** 2).sum(axis=1)[:, None] - proj ** 2
    inside = (proj > 2.0) & (proj < 26.0) & (perp2 < 36.0)
    counts = inside.sum(axis=0)
    k = int(np.argmin(counts))
    return dirs[k], int(counts[k])


# ---------------------------------------------------------------- the crystal ligand as an RDKit molecule
def ligand_mol(atoms, smiles):
    """Build the bound ligand with bonds. Proximity bonding gives the connectivity; the chemical component's own
    SMILES then sets the bond orders, so the picture shows the right double bonds and aromatic rings."""
    lines = []
    for i, a in enumerate(atoms, 1):
        lines.append("HETATM%5d %-4s %3s %s%4s    %8.3f%8.3f%8.3f  1.00  0.00          %2s" % (
            i, a["name"][:4], a["resn"][:3], a["chain"], str(a["resi"])[:4], *a["xyz"], a["el"][:2]))
    block = "\n".join(lines) + "\nEND\n"
    mol = Chem.MolFromPDBBlock(block, sanitize=False, removeHs=True, proximityBonding=True)
    if mol is None:
        return None, "pdb block would not parse"
    try:
        Chem.SanitizeMol(mol, Chem.SanitizeFlags.SANITIZE_ALL ^ Chem.SanitizeFlags.SANITIZE_KEKULIZE)
    except Exception as e:
        return None, f"sanitize failed: {e}"
    if smiles:
        ref = Chem.MolFromSmiles(smiles)
        if ref is not None:
            ref = Chem.RemoveHs(ref)
            try:
                return AllChem.AssignBondOrdersFromTemplate(ref, mol), "bond orders from the component SMILES"
            except Exception:
                pass
    return mol, "bonds by proximity; orders not assigned"


def mol_json(mol, shift):
    """{e, xyz, b}: atomic numbers, coordinates with `shift` removed, and bonds as (i, j, order)."""
    conf = mol.GetConformer()
    e, xyz = [], []
    for i, a in enumerate(mol.GetAtoms()):
        p = conf.GetAtomPosition(i)
        e.append(a.GetAtomicNum())
        xyz += [round(p.x - shift[0], 2), round(p.y - shift[1], 2), round(p.z - shift[2], 2)]
    b = []
    for bd in mol.GetBonds():
        o = 4 if bd.GetIsAromatic() else int(round(bd.GetBondTypeAsDouble()))
        b += [bd.GetBeginAtomIdx(), bd.GetEndAtomIdx(), min(o, 4)]
    return {"e": e, "xyz": xyz, "b": b}


def aligned_pose(smiles, template):
    """Place `smiles` on the crystal ligand by their maximum common substructure.
    Returns (mol with a conformer, matched atom count, RMSD over the matched atoms) or (None, 0, None)."""
    probe = Chem.MolFromSmiles(smiles)
    if probe is None or template is None:
        return None, 0, None
    probe = Chem.AddHs(probe)
    ps = AllChem.ETKDGv3()
    ps.randomSeed = SEED
    ps.pruneRmsThresh = 0.5
    cids = AllChem.EmbedMultipleConfs(probe, numConfs=N_CONF, params=ps)
    if not len(cids):
        return None, 0, None
    try:
        AllChem.MMFFOptimizeMoleculeConfs(probe, maxIters=400)
    except Exception:
        pass
    probe = Chem.RemoveHs(probe)
    mcs = rdFMCS.FindMCS([probe, template], ringMatchesRingOnly=True, completeRingsOnly=False,
                         atomCompare=rdFMCS.AtomCompare.CompareElements,
                         bondCompare=rdFMCS.BondCompare.CompareAny, timeout=30)
    if mcs.canceled and not mcs.smartsString:
        return None, 0, None
    patt = Chem.MolFromSmarts(mcs.smartsString or "")
    if patt is None or patt.GetNumAtoms() < MCS_MIN:
        return None, 0, None
    tm = template.GetSubstructMatch(patt)
    pm = probe.GetSubstructMatch(patt)
    if not tm or not pm or len(tm) != len(pm):
        return None, 0, None
    amap = list(zip(pm, tm))
    best, best_rms = None, None
    for cid in cids:
        try:
            rms = rdMolAlign.AlignMol(probe, template, prbCid=int(cid), atomMap=amap)
        except Exception:
            continue
        if best_rms is None or rms < best_rms:
            best_rms, best = rms, int(cid)
    if best is None:
        return None, 0, None
    keep = Chem.Conformer(probe.GetConformer(best))      # copied before the other conformers are dropped
    out = Chem.Mol(probe)
    out.RemoveAllConformers()
    keep.SetId(0)
    out.AddConformer(keep, assignId=True)
    return out, patt.GetNumAtoms(), round(float(best_rms), 2)


# ---------------------------------------------------------------- one scene
def candidates(http, acc, forced, log):
    """PDB entries worth opening for this protein: the forced one, else the entries SIFTS ranks for the accession that
    carry at least one non-polymer entity of drug-like mass. The entry record has no list of which components are
    bound, so the ligand itself is found in the coordinate file."""
    if forced:
        ids = [forced.upper()]
    else:
        js = http.json(SIFTS.format(acc)) or {}
        ids = [(c.get("pdb_id") or "").upper() for c in (js.get(acc) or [])[:18]]
    out, seen = [], set()
    for pid in ids:
        if not pid or pid in seen:
            continue
        seen.add(pid)
        ent = http.json(RCSB_ENTRY.format(pid))
        if not ent:
            continue
        info = ent.get("rcsb_entry_info", {}) or {}
        n = info.get("nonpolymer_entity_count") or 0
        kda = info.get("nonpolymer_molecular_weight_maximum")
        if not forced and (not n or (kda is not None and not (0.15 <= kda <= 1.2))):
            log.append(f"{pid}: {n} non-polymer entities, largest {kda} kDa: no drug-like ligand")
            continue
        out.append((pid, ent))
    return out


def comp_info(http, comp):
    """(name, formula, SMILES, InChIKey) of a chemical component from the RCSB chemical dictionary."""
    js = http.json(RCSB_COMP.format(comp)) or {}
    cc, d = js.get("chem_comp", {}) or {}, js.get("rcsb_chem_comp_descriptor", {}) or {}
    return ((cc.get("name") or "").strip().lower(), (cc.get("formula") or "").strip(),
            d.get("SMILES_stereo") or d.get("smiles_stereo") or d.get("SMILES") or d.get("smiles") or "",
            d.get("InChIKey") or d.get("in_ch_ikey") or d.get("inchikey") or "")


def open_entry(http, pid, skeletons):
    """Download and parse one entry and pick its bound molecule.
    Returns (prot, latoms, comp, chain, resi, name, formula, smiles, inchikey, matched_drug_skeleton) or None."""
    st, text = http.get(RCSB_PDB.format(pid), binary=True)
    if st != 200 or "\nATOM  " not in text[:400000]:
        return None, f"{pid}: no PDB-format coordinate file (too large or cif-only)"
    prot, het = parse_pdb(text)
    if len(prot) < 200:
        return None, f"{pid}: parsed only {len(prot)} protein atoms"
    best = None
    for (comp, chain, resi), atoms in ligand_instances(het):
        if len(atoms) < 12 or comp in COFACTOR:
            continue
        name, formula, smiles, ik = comp_info(http, comp)
        hit = bool(ik) and ik[:14] in skeletons
        cand = (prot, atoms, comp, chain, resi, name, formula, smiles, ik, hit)
        if hit:
            return cand, None                       # the drug itself sits in this pocket: nothing beats that
        if best is None:
            best = cand
    if best is None:
        return None, f"{pid}: no bound molecule with at least 12 heavy atoms outside the cofactor list"
    return best, None


def build_scene(http, gid, label, members, forced, verbose=True):
    """members: [{cid, name, smiles, act}] -- the drugs of this Hansch group."""
    log = []
    t = http.json(CHEMBL.format(gid))
    if not t:
        return None, [f"{gid}: ChEMBL target not available"]
    comps = t.get("target_components") or []
    acc = next((c.get("accession") for c in comps if c.get("accession")), None)
    pref = t.get("pref_name") or label
    if not acc:
        return None, [f"{gid}: ChEMBL target has no UniProt accession"]
    skeletons = {(m.get("ik") or "")[:14] for m in members if m.get("ik")}
    cands = candidates(http, acc, forced, log)
    if not cands:
        return None, log + [f"{gid} ({acc}): no PDB entry with a drug-like ligand"]
    chosen, ent = None, None
    for pid, e in cands:
        got, why = open_entry(http, pid, skeletons)
        if why:
            log.append(f"{gid}: {why}")
            continue
        if chosen is None or (got[9] and not chosen[9]):
            chosen, ent, chosen_pid = got, e, pid
        if chosen[9]:
            break                                   # an entry with the drug itself bound: stop looking
    if chosen is None:
        return None, log + [f"{gid} ({acc}): none of {len(cands)} entries yielded a bound molecule"]
    prot, latoms, comp, lchain, lresi, lname, lformula, lsmiles, likey, _hit = chosen
    pid = chosen_pid
    lig, bondnote = ligand_mol(latoms, lsmiles)
    if lig is None:
        return None, log + [f"{gid}: {pid} ligand {comp} would not build ({bondnote})"]
    shift = centroid([a["xyz"] for a in latoms])

    # pocket residues and their heavy atoms
    L = np.asarray([a["xyz"] for a in latoms], float)
    byres = defaultdict(list)
    for a in prot:
        byres[(a["chain"], a["resi"], a["resn"])].append(a)
    res, atoms_e, atoms_xyz, atoms_r = [], [], [], []
    pocket_atoms = []
    for key, ats in byres.items():
        P = np.asarray([a["xyz"] for a in ats], float)
        d = np.sqrt(((P[:, None, :] - L[None, :, :]) ** 2).sum(-1)).min()
        if d > POCKET_R:
            continue
        ri = len(res)
        chain, resi, resn = key
        res.append({"n": resn, "c": chain, "i": resi,
                    "k": "charged" if resn in CHARGED else ("polar" if resn in POLAR else "apolar"),
                    "d": round(float(d), 2)})
        for a in ats:
            atoms_e.append(a["z"])
            atoms_xyz += [round(a["xyz"][0] - shift[0], 2), round(a["xyz"][1] - shift[1], 2), round(a["xyz"][2] - shift[2], 2)]
            atoms_r.append(ri)
            pocket_atoms.append(a)
    if len(res) < 5:
        return None, log + [f"{gid}: {pid} pocket has only {len(res)} residues"]

    # CA ribbon of the chains that line the pocket
    chains = {r["c"] for r in res}
    trace, tseg = [], []
    for ch in sorted(chains):
        cas = [a for a in prot if a["chain"] == ch and a["name"] == "CA"]
        if len(cas) < 4:
            continue
        step = max(1, math.ceil(len(cas) / (TRACE_MAX / max(1, len(chains)))))
        pts = cas[::step]
        start = len(trace) // 3
        for a in pts:
            trace += [round(a["xyz"][0] - shift[0], 2), round(a["xyz"][1] - shift[1], 2), round(a["xyz"][2] - shift[2], 2)]
        tseg.append([start, len(trace) // 3 - start])

    # contacts between the crystal ligand and the pocket
    contacts = []
    for i, a in enumerate(latoms):
        for j, b in enumerate(pocket_atoms):
            d = math.dist(a["xyz"], b["xyz"])
            if a["el"] in ("N", "O", "F", "S") and b["el"] in ("N", "O", "S") and d <= HB_R:
                contacts.append({"a": i, "p": j, "d": round(d, 2), "t": "hb"})
            elif a["el"] == "C" and b["el"] == "C" and d <= HPHOB_R:
                contacts.append({"a": i, "p": j, "d": round(d, 2), "t": "hp"})
    contacts.sort(key=lambda c: (c["t"] != "hb", c["d"]))
    contacts = contacts[:48]

    adir, occ = approach_vector([a["xyz"] for a in latoms], [a["xyz"] for a in prot])
    radius = float(np.abs(np.asarray(atoms_xyz, float).reshape(-1, 3)).max()) if atoms_xyz else 12.0

    # The member poses. A member counts as the crystallised ligand itself when its InChIKey skeleton matches, or when
    # the common substructure covers every heavy atom of both (the same connectivity drawn as another tautomer or
    # protonation state, which is how several deposited components differ from the drug's own InChIKey). Those members
    # keep the measured coordinates; the rest are aligned.
    skel, lig_n = (likey or "")[:14], lig.GetNumAtoms()
    xtal_note = None
    poses = []
    for m in members:
        if not m.get("smiles"):
            continue
        probe = Chem.MolFromSmiles(m["smiles"])
        heavy = probe.GetNumAtoms() if probe else 0
        if bool(skel) and (m.get("ik") or "")[:14] == skel:
            nmcs, rms, same = lig_n, 0.0, True
            mol = lig
        else:
            mol, nmcs, rms = aligned_pose(m["smiles"], lig)
            if mol is None:
                log.append(f"{gid}: {m['name']} shares too little with {comp} to be placed")
                continue
            same = nmcs == lig_n == heavy
            if same:
                mol, rms = lig, 0.0
                xtal_note = (f"{m['name']} and the deposited component {comp} have the same heavy-atom connectivity but "
                             f"different InChIKeys ({m.get('ik')} and {likey}): the component is drawn as another "
                             f"tautomer or protonation state. The measured coordinates are used.")
        p = mol_json(mol, shift)
        p.update({"cid": m["cid"], "name": m["name"], "mcs": int(nmcs), "rmsd": rms, "xtal": bool(same)})
        if m.get("act") is not None:
            p["act"] = m["act"]
        poses.append(p)
    poses.sort(key=lambda p: (not p["xtal"], p["rmsd"] if p["rmsd"] is not None else 9))

    scene = {
        "id": gid, "target": pref, "label": label, "uniprot": acc,
        "pdb": {
            "id": pid,
            "title": ((ent.get("struct") or {}).get("title") or "").strip(),
            "method": ", ".join(sorted({(e.get("method") or "").title() for e in (ent.get("exptl") or []) if e.get("method")})),
            "resolution": next(iter((ent.get("rcsb_entry_info") or {}).get("resolution_combined") or []), None),
            "deposited": ((ent.get("rcsb_accession_info") or {}).get("deposit_date") or "")[:10],
        },
        "lig": {"comp": comp, "chain": lchain, "resi": lresi, "name": lname, "formula": lformula,
                "smiles": lsmiles, "ik": likey, "bonds": bondnote},
        "approach": [round(float(v), 3) for v in adir], "approach_atoms": occ,
        "radius": round(radius, 1),
        "res": res, "atoms": {"e": atoms_e, "xyz": atoms_xyz, "r": atoms_r},
        "trace": {"xyz": trace, "seg": tseg},
        "bound": mol_json(lig, shift),
        "contacts": contacts,
        "poses": poses,
    }
    if xtal_note:
        scene["lig"]["tautomer_note"] = xtal_note
    if verbose:
        print(f"  {gid} {pref[:34]:34s} {pid} {comp:4s} res={len(res):3d} atoms={len(atoms_e):4d} "
              f"contacts={len(contacts):2d} poses={len(poses)}/{len(members)}")
    return scene, log


# ---------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--site", default=os.path.join(here, "site"))
    ap.add_argument("--out", default=None, help="default: <site>/data/binding")
    ap.add_argument("--cache", default=os.path.join(here, "tools", "data", "cache_binding"))
    ap.add_argument("--only", action="append", default=[], help="build these ChEMBL target ids only")
    ap.add_argument("--extra", action="append", default=["CHEMBL1941"], help="targets to build that have no Hansch group")
    ap.add_argument("--pdb", action="append", default=[], help="CHEMBLid=PDBID: force the entry")
    ap.add_argument("--cohort", default=None, help="cohort json whose drugs join the --extra target's group")
    a = ap.parse_args(argv)
    out = a.out or os.path.join(a.site, "data", "binding")
    os.makedirs(out, exist_ok=True)
    forced = dict(p.split("=", 1) for p in a.pdb)

    drugs = json.load(open(os.path.join(a.site, "data", "drugs.json"), encoding="utf-8"))["drugs"]
    by_cid = {d["cid"]: d for d in drugs}
    hansch = json.load(open(os.path.join(a.site, "data", "hansch.json"), encoding="utf-8"))
    groups = {g["id"]: g for g in hansch["groups"] if g["id"] != "ALL"}

    members = {}
    for gid, g in groups.items():
        ms = []
        for p in g["points"]:
            d = by_cid.get(p["cid"])
            if d:
                ms.append({"cid": d["cid"], "name": d["name"], "smiles": d.get("smiles"), "ik": d.get("ik"),
                           "act": (d.get("act") or {}).get("p")})
        members[gid] = ms
    labels = {gid: g.get("label") or gid for gid, g in groups.items()}

    # targets with no fit group (the H2 cohort): take their members from the cohort file when there is one
    for gid in a.extra:
        if gid in members:
            continue
        ms = []
        if a.cohort and os.path.exists(a.cohort):
            cj = json.load(open(a.cohort, encoding="utf-8"))
            seen = set()
            for d in cj.get("rows", []):           # one row per drug and route, so a drug can repeat
                key = d.get("ik") or d.get("cid") or d.get("name")
                if not d.get("smiles") or key in seen:
                    continue
                seen.add(key)
                ms.append({"cid": d.get("cid"), "name": d["name"], "smiles": d["smiles"], "ik": d.get("ik"),
                           "act": d.get("act")})
        if not ms:
            ms = [{"cid": d["cid"], "name": d["name"], "smiles": d.get("smiles"), "ik": d.get("ik"),
                   "act": (d.get("act") or {}).get("p")} for d in drugs
                  if any(x["code"].startswith("A02BA") for x in d["atc"])] if gid == "CHEMBL1941" else []
        members[gid] = ms
        labels[gid] = labels.get(gid, gid)

    want = a.only or list(groups) + [g for g in a.extra if g in members]
    http = Http(a.cache)
    index, notes = [], []
    print(f"binding scenes for {len(want)} target(s)")
    for gid in want:
        if gid not in members:
            notes.append(f"{gid}: no members")
            continue
        try:
            scene, log = build_scene(http, gid, labels.get(gid, gid), members[gid], forced.get(gid))
        except Exception as e:                      # one bad entry must not lose the rest of the run
            scene, log = None, [f"{gid}: build failed: {type(e).__name__}: {e}"]
        notes += log
        if not scene:
            continue
        path = os.path.join(out, f"{gid}.json")
        json.dump(scene, open(path, "w", encoding="utf-8"), separators=(",", ":"))
        index.append({"id": gid, "target": scene["target"], "pdb": scene["pdb"]["id"], "lig": scene["lig"]["comp"],
                      "lig_name": scene["lig"]["name"], "uniprot": scene["uniprot"],
                      "resolution": scene["pdb"]["resolution"], "method": scene["pdb"]["method"],
                      "n_res": len(scene["res"]), "n_poses": len(scene["poses"]), "radius": scene["radius"],
                      "kb": round(os.path.getsize(path) / 1024, 1)})
    index.sort(key=lambda r: -r["n_poses"])
    json.dump({"generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
               "pocket_radius_a": POCKET_R, "hbond_a": HB_R, "hydrophobic_a": HPHOB_R, "mcs_min_atoms": MCS_MIN,
               "seed": SEED, "scenes": index, "notes": notes},
              open(os.path.join(out, "index.json"), "w", encoding="utf-8"), indent=1)

    prov = os.path.join(a.site, "data", "provenance.csv")
    new = not os.path.exists(prov)
    with open(prov, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["url", "status", "bytes", "utc", "cached"])
        for r in http.log:
            w.writerow([r["url"], r["status"], r["bytes"], r["utc"], r["cached"]])
    print(f"\n{len(index)} scene(s) written to {out}")
    for n in notes:
        print("  note:", n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
