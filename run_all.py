"""Hardware-Abbildung der QUBO-Instanzen: jede Instanz des Gitters mit mehreren Seeds auf eine Hardware abbilden.

    python run_all.py --hardware advantage_pegasus            # fehlende (Instanz, Seed)-Läufe nachholen, Ergebnis in results/<hardware>.json
    python run_all.py --hardware advantage_pegasus --figure   # danach die Abbildung neu zeichnen (ohne Neuberechnung geht das mit --figure-only)

Ergebnisse werden nur ergänzt: schon gerechnete (Instanz, Seed)-Paare bleiben. Das Gitter (Model A/B × OH/DW/BIN × n = 4 … 18, R = n/2)
steht einmal in results/instances.json, damit jede Hardware dieselben Instanzen abbildet.
"""
from __future__ import annotations

import argparse
import importlib
import platform
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from datetime import date

from hw import common
from hw.models import ENCODINGS, MODELS

# Hardware → (Modul, Funktion). Ein Schritt = ein Eintrag; neue Hardware kommt erst mit ihrem Schritt dazu.
HARDWARE = {"advantage_pegasus": ("hw.advantage_pegasus", "map_advantage_pegasus"),
            "advantage2_zephyr": ("hw.advantage2_zephyr", "map_advantage2_zephyr"),
            "heron": ("hw.heron", "map_heron"),
            "nighthawk": ("hw.nighthawk", "map_nighthawk"),
            "helios": ("hw.helios", "map_helios")}
# Embedding-Läufe haben ein Zeitlimit (timeout); gatterbasierte Hardware und Helios nicht
TIMEOUT_HARDWARE = {"advantage_pegasus", "advantage2_zephyr"}

_INST: dict = {}


def _fn(hardware: str):
    module, name = HARDWARE[hardware]
    return getattr(importlib.import_module(module), name)


def _init(path: str) -> None:
    _INST.update(common.load_instances())


def _work(hardware: str, iid: str, seed: int, kwargs: dict) -> tuple[str, int, dict]:
    inst = _INST["instances"][iid]
    rec = _fn(hardware)(common.bqm_of(inst), seed, **kwargs)
    rec.update(model=inst["model"], encoding=inst["encoding"], n=inst["n"])
    return iid, seed, rec


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hardware", choices=sorted(HARDWARE), default="advantage_pegasus")
    ap.add_argument("--seeds", type=int, default=10, help="Seeds je Instanz (mindestens 10 für den Bericht)")
    ap.add_argument("--timeout", type=float, default=60.0, help="Sekunden je Lauf (ein Seed)")
    ap.add_argument("--budget", type=float, default=7200.0, help="Sekunden für das ganze Gitter; danach werden keine Läufe mehr gestartet")
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--orders", type=int, nargs="*", help="nur diese n (Standard: alle)")
    ap.add_argument("--models", nargs="*", choices=sorted(MODELS), help="nur diese Modelle")
    ap.add_argument("--encodings", nargs="*", choices=sorted(ENCODINGS), help="nur diese Kodierungen")
    ap.add_argument("--export", action="store_true", help="Instanzgitter neu exportieren")
    ap.add_argument("--figure", action="store_true", help="nach den Läufen die Abbildung zeichnen")
    ap.add_argument("--figure-only", action="store_true", help="nur die Abbildung aus results/*.json zeichnen")
    args = ap.parse_args()
    args.seeds = getattr(importlib.import_module(HARDWARE[args.hardware][0]), "SEEDS", None) or args.seeds  # Helios: deterministisch, 1 Seed

    if args.figure_only:
        from hw import make_figures
        print(*make_figures.draw([args.hardware]), sep="\n")
        return
    if args.export or not common.INSTANCES.exists():
        t = time.time()
        common.export_instances()
        print(f"Instanzgitter exportiert: {common.INSTANCES} ({time.time() - t:.0f} s)")
    instances = common.load_instances()["instances"]
    ids = [i for m, e, n in common.grid() if (not args.models or m in args.models) and (not args.encodings or e in args.encodings)
           and (not args.orders or n in args.orders) for i in [common.instance_id(m, e, n)]]
    res = common.load_results(args.hardware)
    done = {(r["model"], r["encoding"], r["n"], r["seed"]) for r in res["records"]}
    todo = [(i, s) for i in ids for s in range(args.seeds)
            if (instances[i]["model"], instances[i]["encoding"], instances[i]["n"], s) not in done]
    limit = f"Zeitlimit {args.timeout:.0f} s je Lauf, " if args.hardware in TIMEOUT_HARDWARE else ""
    print(f"{args.hardware}: {len(ids)} Instanzen × {args.seeds} Seeds, {len(todo)} Läufe offen, {limit}Budget {args.budget:.0f} s, {args.workers} Prozesse")
    res["meta"] = {**_meta(args.hardware), **({"timeout_s": args.timeout} if args.hardware in TIMEOUT_HARDWARE else {}), "seeds": args.seeds, "budget_s": args.budget,
                   "updated": date.today().isoformat(), "python": platform.python_version()}
    kwargs = {"timeout": args.timeout} if args.hardware in TIMEOUT_HARDWARE else {}
    start = time.time()
    skipped = 0
    with ProcessPoolExecutor(args.workers, initializer=_init, initargs=("",)) as pool:
        pending: set = set()
        queue = iter(todo)
        exhausted = False
        while pending or not exhausted:
            while not exhausted and len(pending) < args.workers * 2:
                if time.time() - start > args.budget:
                    skipped = sum(1 for _ in queue) + 1
                    exhausted = True
                    break
                try:
                    i, s = next(queue)
                except StopIteration:
                    exhausted = True
                    break
                pending.add(pool.submit(_work, args.hardware, i, s, kwargs))
            if not pending:
                break
            finished, pending = wait(pending, return_when=FIRST_COMPLETED)
            for f in finished:
                iid, seed, rec = f.result()
                res["records"].append(rec)
                print(f"  {iid:10s} seed {seed}: {rec['status']:13s} physical={rec['physical_qubits']} max_chain={rec['max_chain']} "
                      f"({rec['runtime_s']:.0f} s)", flush=True)
            common.write_json(common.results_path(args.hardware), res)
    if skipped:
        print(f"Budget erreicht: {skipped} Läufe nicht gestartet (beim nächsten Aufruf nachholbar)")
    print_summary(res["records"], args.hardware)
    if args.figure:
        from hw import make_figures
        print(*make_figures.draw([args.hardware]), sep="\n")


def _meta(hardware: str) -> dict:
    return importlib.import_module(HARDWARE[hardware][0]).meta()


def print_summary(records: list[dict], hardware: str = "advantage_pegasus") -> None:
    from hw.make_figures import METRIC
    field, label = METRIC[hardware]
    agg = common.aggregate(records)
    print(f"{'instance':10s} {'logical':>7s} {'couplings':>9s} {'mapped':>7s} {label + ' best (min-max)':>36s} {'max chain (min)':>16s}")
    for (m, e, n), a in sorted(agg.items()):
        p = a.get(field)
        phys = "%d (%d-%d)" % (p["best"], p["min"], p["max"]) if p else a["status"]
        chain = str(a["max_chain"]["min"]) if "max_chain" in a else "-"
        print(f"{m}-{e}-{n:<4d} {a['logical_qubits']:7d} {a['couplings']:9d} {a['mapped_seeds']:3d}/{a['seeds']:<3d} {phys:>36s} {chain:>16s}")

if __name__ == "__main__":
    sys.exit(main())
