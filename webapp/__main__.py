"""Startet die Website lokal.

    python -m webapp                       # http://127.0.0.1:8003
    python -m webapp --port 8080 --open    # anderer Port, Browser öffnen
    python -m webapp --data-dir <ordner>   # anderer Datenordner
"""
from __future__ import annotations

import argparse
import os
import threading
import webbrowser

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="QUBO-MRTA Lernlabor lokal starten")
    parser.add_argument("--host", default="127.0.0.1", help="Standard: nur dieser Rechner")
    parser.add_argument("--port", type=int, default=8003)
    parser.add_argument("--data-dir", help="Ordner mit transport_events_*.csv / transport_fleet_*.csv")
    parser.add_argument("--open", action="store_true", help="Browser automatisch öffnen")
    parser.add_argument("--reload", action="store_true", help="Server bei Code-Änderungen neu starten")
    args = parser.parse_args()

    if args.data_dir:
        os.environ["QUBO_DATA_DIR"] = args.data_dir
    url = f"http://{args.host}:{args.port}"
    print(f"Lernlabor läuft auf {url}  (beenden mit Strg+C)")
    if args.open:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run("webapp.server:app", host=args.host, port=args.port, reload=args.reload, log_level="warning")


if __name__ == "__main__":
    main()
