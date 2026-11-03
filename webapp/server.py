"""FastAPI-Server der Website: JSON-API unter /api, Oberfläche als statische Dateien."""
from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path

import plotly
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .data_service import DataService, resources

STATIC_DIR = Path(__file__).resolve().parent / "static"
# Unter Windows liest Python MIME-Typen aus der Registry, dort steht .js oft als text/plain –
# Browser laden ES-Module dann nicht. Deshalb explizit setzen.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
# plotly.js wird aus dem installierten Python-Paket ausgeliefert – funktioniert ohne Internet.
PLOTLY_JS = Path(plotly.__file__).resolve().parent / "package_data" / "plotly.min.js"


def _parse(tasks: str, params: str) -> tuple[list[int], dict]:
    """Auftragsliste „1,2,3“ und Parameter-JSON aus der URL lesen."""
    try:
        ids = [int(x) for x in tasks.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "tasks muss eine Komma-Liste von Auftragsnummern sein")
    try:
        overrides = json.loads(params) if params else {}
        if not isinstance(overrides, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(400, "params muss ein JSON-Objekt sein, z.B. {\"v\": 1.5}")
    return ids, overrides


def _ia(method, run_id: str, tasks: str, robots: str, variables: str, kriterium: str, params: str) -> dict:
    """Gemeinsamer Ablauf der IA-Endpunkte: Aufträge, Roboter (leer = alle freien) und Parameter lesen."""
    ids, overrides = _parse(tasks, params)
    try:
        robot_ids = [int(x) for x in robots.split(",") if x.strip()] or None
    except ValueError:
        raise HTTPException(400, "robots muss eine Komma-Liste von Roboternummern sein")
    try:
        return method(run_id, ids, robot_ids, variables, kriterium, overrides)
    except KeyError:
        raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


def create_app(data_dir: str | Path | None = None) -> FastAPI:
    service = DataService(data_dir)
    app = FastAPI(title="QUBO-MRTA Lernlabor", docs_url="/api/docs", redoc_url=None)

    @app.middleware("http")
    async def revalidate_static(request, call_next):
        # Browser sollen Oberflächen-Dateien bei jedem Laden kurz prüfen (ETag) – sonst
        # mischen sich nach einem Update alte und neue JS-Module.
        response = await call_next(request)
        if request.url.path == "/" or request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/api/runs")
    def list_runs() -> dict:
        return {"data_dir": str(service.data_dir), "runs": service.overview()}

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str) -> dict:
        try:
            return service.payload(run_id)
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")

    @app.get("/api/runs/{run_id}/one-hot")
    def get_one_hot(run_id: str, tasks: str, variables: str = "kandidaten", kriterium: str = "leerfahrt",
                    params: str = "") -> dict:
        """One-Hot-Formulierung für gewählte Aufträge.

        Beispiel: ?tasks=1,2&variables=kandidaten&kriterium=erledigungszeit&params={"v":1.5}
        """
        ids, overrides = _parse(tasks, params)
        try:
            return service.one_hot(run_id, ids, variables, kriterium, overrides)
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/runs/{run_id}/ia/one-hot")
    def get_ia_one_hot(run_id: str, tasks: str, robots: str = "", variables: str = "kandidaten",
                       kriterium: str = "fahrstrecke", params: str = "") -> dict:
        """Sofortzuweisung (IA) mit One-Hot – Fall T = R, T < R oder T > R ergibt sich aus Aufträgen und Robotern.

        Beispiel: ?tasks=1,2,3&robots=61,62,63,64&kriterium=wartezeit   (robots leer = alle freien)
        """
        return _ia(service.ia_one_hot, run_id, tasks, robots, variables, kriterium, params)

    @app.get("/api/runs/{run_id}/ia/domain-wall")
    def get_ia_domain_wall(run_id: str, tasks: str, robots: str = "", variables: str = "kandidaten",
                           kriterium: str = "fahrstrecke", params: str = "") -> dict:
        """Sofortzuweisung (IA) mit Domain Wall – Ketten je Auftrag (T ≤ R) bzw. je Roboter (T > R).

        Beispiel: ?tasks=1,2,3,4,5&robots=61,62&kriterium=fahrzeit   (robots leer = alle freien)
        """
        return _ia(service.ia_domain_wall, run_id, tasks, robots, variables, kriterium, params)

    @app.get("/api/runs/{run_id}/ia/binary")
    def get_ia_binary(run_id: str, tasks: str, robots: str = "", variables: str = "kandidaten",
                      kriterium: str = "fahrstrecke", params: str = "") -> dict:
        """Sofortzuweisung (IA) mit Binary – Code je Auftrag (T ≤ R) bzw. je Roboter (T > R), Hilfsbits ab Grad 3.

        Beispiel: ?tasks=1,2,3&robots=61,62,63&kriterium=wartezeit   (robots leer = alle freien)
        """
        return _ia(service.ia_binary, run_id, tasks, robots, variables, kriterium, params)

    @app.get("/api/runs/{run_id}/ta/{encoding}")
    def get_ta_workload(run_id: str, encoding: str, tasks: str, robots: str = "", variables: str = "kandidaten",
                        last: str = "zeit", anteile: str = "", vorlast: str = "status", params: str = "") -> dict:
        """Zuweisung mit Reihenfolge (TA) mit Lastverteilung H_WB – encoding = one-hot | domain-wall | binary.

        Beispiel: ?tasks=1,2,3,4&robots=61,62,63&last=zeit&anteile=anfahrt,beladen,lastfahrt,entladen&vorlast=status
        (robots leer = alle freien, anteile leer = alle des Lastmaßes)
        """
        enc = {"one-hot": "one_hot", "domain-wall": "domain_wall", "binary": "binary"}.get(encoding)
        if enc is None:
            raise HTTPException(404, f"Unbekannte Kodierung: {encoding}")
        ids, overrides = _parse(tasks, params)
        try:
            robot_ids = [int(x) for x in robots.split(",") if x.strip()] or None
        except ValueError:
            raise HTTPException(400, "robots muss eine Komma-Liste von Roboternummern sein")
        parts = [x.strip() for x in anteile.split(",") if x.strip()] or None
        try:
            return service.ta_workload(run_id, enc, ids, robot_ids, variables, last, parts, vorlast, overrides)
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/ressourcen/katalog")
    def get_resources_catalog() -> dict:
        """Klassen, Kodierungen und Varianten der Ressourcen-Rechnung."""
        return {"classes": list(resources.CLASSES), "encodings": list(resources.ENCODINGS), "variants": resources.VARIANTS,
                "check_max_bits": resources.CHECK_MAX_BITS}

    @app.post("/api/runs/{run_id}/ressourcen")
    def post_resources(run_id: str, body: dict = Body(...)) -> dict:
        """Kennzahlen je Fall. Body: {"cases": [{"cls": "IA"|"TA", "encoding": …, "variant": …, "tasks": [1, 2], "robots": [61],
        "variables": "kandidaten", "kriterium" | "last"/"anteile"/"vorlast", "struktur": false, "T": 3, "R": 3, "vparams": {"kap": 2, "delta": 10},
        "kurz": true}]} – kurz: nur Qubits und Kopplungen zählen (Reiter Qubits & Kopplungen)"""
        cases = body.get("cases")
        if not isinstance(cases, list) or not cases:
            raise HTTPException(400, "cases muss eine nicht leere Liste sein")
        try:
            return {"cases": service.resources(run_id, cases[:24])}
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")

    @app.post("/api/ressourcen/skalierung")
    def post_resources_scaling(body: dict = Body(...)) -> dict:
        """Kennzahlen je Vorlage über T (R fest) oder R (T fest), nur Struktur. Body: {"templates": [...], "axis": "T", "fixed": 3, "upto": 6}"""
        try:
            return {"series": resources.scaling(body.get("templates") or [], body.get("axis", "T"), int(body.get("fixed", 3)),
                                                min(8, int(body.get("upto", 6))))}
        except (ValueError, KeyError) as exc:
            raise HTTPException(400, str(exc))

    @app.post("/api/ressourcen/groessen")
    def post_resources_sizes(body: dict = Body(...)) -> dict:
        """Verlauf über gemischte Instanzgrößen T × R bis T = 18 (nur Struktur); „svg“ ist die Abbildung im Paper-Stil.
        Body: {"cls": "IA" | "TA", "ratio": "halb" | "fest" | "quadrat", "R": 3, "schwarzweiss": true, "hardware_limits": true}
        – hardware_limits: Strich-Punkt-Linien für das größte je Hardware abgebildete Problem (aus results/*.json)"""
        try:
            return service.resources_sizes(body.get("cls", "IA"), body.get("ratio", "halb"), int(body.get("R", 3)),
                                           bool(body.get("schwarzweiss", True)), bool(body.get("hardware_limits", True)))
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/hardware")
    def get_hardware() -> dict:
        """Ergebnisse der Hardware-Abbildung je Hardware (Metadaten, Fortschritt, Zeilen je Instanz, Grenze) – nur aus results/*.json."""
        return service.hardware()

    @app.get("/api/hardware/abbildung")
    def get_hardware_figure(hardware: str = "", schwarzweiss: bool = True) -> dict:
        """Abbildung als SVG: eine Spalte je Hardware (Komma-Liste, leer = alle mit Ergebnissen), Zeilen Model A und B."""
        try:
            return service.hardware_figure([h for h in hardware.split(",") if h.strip()], schwarzweiss)
        except ValueError as exc:
            raise HTTPException(404, str(exc))

    @app.get("/api/ressourcen/landkarte")
    def get_resources_landscape(ia: str = "paar", ta: str = "wb") -> dict:
        """Fall-Landkarte T × R = 1 … 6 für IA und TA, alle drei Kodierungen (nur Struktur, zwischengespeichert)."""
        try:
            return resources.landscape({"IA": ia, "TA": ta})
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.post("/api/runs/{run_id}/ressourcen/verlauf")
    def post_resources_timeline(run_id: str, body: dict = Body(...)) -> dict:
        """Verlauf: je Anfrage echte T, R und die Kennzahlen je Vorlage. Body: {"templates": [...], "schnitt": "fenster"|"offen",
        "fenster": 60, "roboter": "frei"|"alle"}"""
        try:
            return service.resources_timeline(run_id, body.get("templates") or [], body.get("schnitt", "fenster"),
                                              float(body.get("fenster", 60)), body.get("roboter", "frei"))
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/runs/{run_id}/domain-wall")
    def get_domain_wall(run_id: str, tasks: str, variables: str = "kandidaten", kriterium: str = "leerfahrt",
                        params: str = "", reihenfolge: str = "nummer") -> dict:
        """Domain-Wall-Formulierung für gewählte Aufträge.

        Beispiel: ?tasks=1,2&kriterium=leerfahrt&reihenfolge=nummer|kosten
        """
        ids, overrides = _parse(tasks, params)
        try:
            return service.domain_wall(run_id, ids, variables, kriterium, overrides, reihenfolge)
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/runs/{run_id}/binary")
    def get_binary(run_id: str, tasks: str, variables: str = "kandidaten", kriterium: str = "leerfahrt",
                   params: str = "", reihenfolge: str = "nummer") -> dict:
        """Binary-Formulierung für gewählte Aufträge.

        Beispiel: ?tasks=1,2&kriterium=leerfahrt&reihenfolge=nummer|kosten
        """
        ids, overrides = _parse(tasks, params)
        try:
            return service.binary(run_id, ids, variables, kriterium, overrides, reihenfolge)
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/runs/{run_id}/reihenfolge")
    def get_sequence(run_id: str, tasks: str, variables: str = "kandidaten", kriterium: str = "erledigungszeit",
                     plaetze: int = 2, params: str = "") -> dict:
        """Zuweisung mit Reihenfolge (Positions-Hilfsvariablen) für gewählte Aufträge.

        Beispiel: ?tasks=1,2,3&plaetze=2&kriterium=erledigungszeit&params={"v":1.5}
        """
        ids, overrides = _parse(tasks, params)
        try:
            return service.sequence(run_id, ids, variables, kriterium, plaetze, overrides)
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.post("/api/runs/{run_id}/baukasten")
    def post_baukasten(run_id: str, body: dict = Body(...)) -> dict:
        """Formel-Baukasten: Instanz + Formulierung aus Bausteinen.

        Body: {"tasks": [1, 2], "plaetze": 2, "kriterium": "erledigungszeit", "variables": "kandidaten",
               "params": {}, "kodierung": "one_hot" | "domain_wall" | "binary" | {"12": "binary", …},
               "reihenfolge": "nummer" | "kosten", "preset": "standard" | "nur_kosten", "terms": [...]}
        """
        try:
            return service.baukasten(run_id, body)
        except KeyError:
            raise HTTPException(404, f"Lauf {run_id} nicht gefunden")
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/vendor/plotly.min.js", include_in_schema=False)
    def plotly_js() -> FileResponse:
        return FileResponse(PLOTLY_JS, media_type="text/javascript")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_app(os.environ.get("QUBO_DATA_DIR"))
