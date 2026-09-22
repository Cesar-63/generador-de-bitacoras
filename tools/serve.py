#!/usr/bin/env python3
"""Sirve la bitácora en local y la guarda en data/bitacora.json.

    python3 tools/serve.py            # http://127.0.0.1:4321
    python3 tools/serve.py --port 8080

Sin dependencias: sólo la librería estándar. El servidor escucha únicamente en
127.0.0.1, así que no queda expuesto fuera de tu máquina.

La app pregunta por `GET api/state` al arrancar. Si responde, trabaja contra el
archivo; si no (GitHub Pages, doble clic al index.html), se queda en el
almacenamiento del navegador.
"""

import argparse
import json
import os
import tempfile
import threading
import webbrowser
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA = DATA_DIR / "bitacora.json"
MIRROR = DATA_DIR / "bitacora.md"
REL = "data/bitacora.json"

COLUMNAS = [("todo", "Por hacer"), ("doing", "En curso"),
            ("review", "En revisión"), ("done", "Hecho")]

LOCK = threading.Lock()

VACIA = {
    "version": 1,
    "settings": {"theme": "system", "accent": "clay", "author": ""},
    "ui": {"view": "hoy", "weekOffset": 0, "tab": "md",
           "includes": {"side": True, "board": True, "reminders": True, "prompt": True}},
    "tasks": [],
    "reminders": [],
    "moves": [],
    "timer": None,
    "seeded": True,
}


def stamp() -> str:
    """Marca de la última escritura; sirve para detectar ediciones de fuera.

    Va como texto a propósito: en nanosegundos no cabe en un número de
    JavaScript sin perder precisión, y entonces todo guardado parecería
    un conflicto."""
    try:
        return str(DATA.stat().st_mtime_ns)
    except FileNotFoundError:
        return "0"


def leer() -> dict:
    if not DATA.exists():
        escribir(VACIA)
    try:
        return json.loads(DATA.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise ValueError(f"{REL} no es JSON válido: {err}") from err


def escribir(data: dict) -> str:
    """Escritura atómica: primero a un temporal, luego reemplazo."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(DATA_DIR), prefix=".bitacora-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp, DATA)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    espejo(data)
    return stamp()


# --------------------------------------------------------------------------- espejo


def _segundos(tarea: dict) -> float:
    total = 0.0
    for s in tarea.get("sessions") or []:
        try:
            ini = datetime.fromisoformat(str(s["start"]).replace("Z", "+00:00"))
            fin = datetime.fromisoformat(str(s["end"]).replace("Z", "+00:00")) if s.get("end") \
                else datetime.now(ini.tzinfo)
            total += max(0.0, (fin - ini).total_seconds())
        except (KeyError, ValueError, TypeError):
            continue
    return total


def _hm(segundos: float) -> str:
    m = int(segundos // 60)
    return f"{m // 60:02d}:{m % 60:02d}"


def espejo(data: dict) -> None:
    """Vista legible de un vistazo. Se regenera entera en cada guardado."""
    tareas = data.get("tasks") or []
    lineas = [
        "# Bitácora",
        "",
        "_Generado automáticamente en cada guardado. No edites este archivo: "
        "la fuente es `bitacora.json`._",
        "",
        f"Actualizado: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
    ]

    corriendo = (data.get("timer") or {}).get("taskId")
    if corriendo:
        activa = next((t for t in tareas if t.get("id") == corriendo), None)
        if activa:
            lineas += ["## Cronómetro", "", f"- {activa.get('title', '')} (corriendo)", ""]

    for col, nombre in COLUMNAS:
        de_la_col = [t for t in tareas if t.get("column") == col]
        if not de_la_col:
            continue
        lineas.append(f"## {nombre}")
        lineas.append("")
        for t in de_la_col:
            subs = t.get("subtasks") or []
            hechas = sum(1 for s in subs if s.get("done"))
            partes = [_hm(_segundos(t))]
            if t.get("project"):
                partes.append(t["project"])
            if subs:
                partes.append(f"{hechas}/{len(subs)} subtareas")
            partes.append("principal" if t.get("kind") == "main" else "secundaria")
            lineas.append(f"- **{t.get('title', '')}** — {' · '.join(partes)}  `{t.get('id', '')}`")
            if t.get("note"):
                lineas.append(f"  - nota: {t['note']}")
        lineas.append("")

    pendientes = [r for r in (data.get("reminders") or []) if not r.get("done")]
    if pendientes:
        lineas += ["## Recordatorios pendientes", ""]
        for r in sorted(pendientes, key=lambda x: str(x.get("at", ""))):
            lineas.append(f"- {r.get('at', '')} — {r.get('text', '')}")
        lineas.append("")

    MIRROR.write_text("\n".join(lineas), encoding="utf-8")


# --------------------------------------------------------------------------- http


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):  # una línea por petición ensucia poco
        if "/api/" in getattr(self, "path", ""):
            return
        super().log_message(fmt, *args)

    def _json(self, code: int, cuerpo: dict) -> None:
        crudo = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(crudo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(crudo)

    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if self.path.split("?")[0].rstrip("/") == "/api/state":
            with LOCK:
                try:
                    datos = leer()
                except ValueError as err:
                    self._json(500, {"error": str(err)})
                    return
                self._json(200, {"stamp": stamp(), "file": REL, "data": datos})
            return
        super().do_GET()

    def do_PUT(self):
        self._guardar()

    def do_POST(self):  # sendBeacon al cerrar la pestaña
        self._guardar()

    def _guardar(self):
        if self.path.split("?")[0].rstrip("/") != "/api/state":
            self.send_error(404)
            return
        largo = int(self.headers.get("Content-Length") or 0)
        try:
            cuerpo = json.loads(self.rfile.read(largo).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"error": "cuerpo ilegible"})
            return

        datos = cuerpo.get("data")
        if not isinstance(datos, dict):
            self._json(400, {"error": "falta 'data'"})
            return

        with LOCK:
            actual = stamp()
            enviado = cuerpo.get("stamp")
            if enviado is not None and actual != "0" and str(enviado) != actual:
                # alguien (Claude, un editor, la CLI) tocó el archivo entretanto:
                # no lo pisamos, devolvemos lo que hay en disco.
                try:
                    en_disco = leer()
                except ValueError as err:
                    self._json(500, {"error": str(err)})
                    return
                self._json(409, {"stamp": actual, "file": REL, "data": en_disco})
                return
            try:
                nuevo = escribir(datos)
            except OSError as err:
                self._json(500, {"error": f"no se pudo escribir: {err}"})
                return
            self._json(200, {"stamp": nuevo, "file": REL})


def main() -> None:
    ap = argparse.ArgumentParser(description="Bitácora en local, guardando en data/bitacora.json")
    ap.add_argument("--port", type=int, default=4321)
    ap.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    args = ap.parse_args()

    with LOCK:
        leer()  # crea data/bitacora.json y su espejo si aún no existen

    url = f"http://127.0.0.1:{args.port}/"
    servidor = ThreadingHTTPServer(("127.0.0.1", args.port),
                                   partial(Handler, directory=str(ROOT)))
    print(f"Bitácora en {url}")
    print(f"Guardando en {DATA}")
    print("Ctrl+C para parar.")
    if not args.no_abrir:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nListo.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
