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

from .data_service import DataService

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
               "params": {}, "preset": "reihenfolge" | "one_hot" | "nur_kosten", "terms": [...]}
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
