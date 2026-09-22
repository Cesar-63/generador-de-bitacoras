#!/usr/bin/env python3
"""Manejar la bitácora desde la terminal, sobre data/bitacora.json.

Pensado para que Claude (o tú) trabaje sin abrir el navegador. La app, si está
abierta, recoge los cambios en unos segundos.

    python3 tools/bitacora.py ver
    python3 tools/bitacora.py add "Migrar endpoints" --proyecto Atlas
    python3 tools/bitacora.py sub a1b2c3 "Mapear los actuales"
    python3 tools/bitacora.py tiempo a1b2c3 45
    python3 tools/bitacora.py mover a1b2c3 review
    python3 tools/bitacora.py cerrar a1b2c3
    python3 tools/bitacora.py recordar "Enviar el avance" --cuando "2026-09-25 17:00"
    python3 tools/bitacora.py semana
"""

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from serve import COLUMNAS, REL, _hm, escribir, leer  # noqa: E402

DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
NOMBRE_COL = dict(COLUMNAS)
REPETICIONES = ["once", "daily", "weekdays", "weekly"]
PROMPT = ("Con esta bitácora, escribe un resumen ejecutivo de máximo 200 palabras: "
          "logros de la semana, tiempo por proyecto, bloqueos y lo que queda pendiente.")


def nuevo_id() -> str:
    return uuid4().hex[:10]


def ahora_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def buscar(data: dict, prefijo: str) -> dict:
    """Acepta el id completo o un prefijo, si no es ambiguo."""
    candidatas = [t for t in data["tasks"] if t["id"] == prefijo]
    if not candidatas:
        candidatas = [t for t in data["tasks"] if t["id"].startswith(prefijo)]
    if not candidatas:
        sys.exit(f"No hay ninguna tarea con id «{prefijo}». Mira `ver` para los ids.")
    if len(candidatas) > 1:
        ids = ", ".join(t["id"] for t in candidatas)
        sys.exit(f"«{prefijo}» es ambiguo: {ids}")
    return candidatas[0]


def _aware(texto: str) -> datetime:
    d = datetime.fromisoformat(str(texto).replace("Z", "+00:00"))
    return d if d.tzinfo else d.astimezone()


def segundos(tarea: dict, desde: datetime = None, hasta: datetime = None) -> float:
    total = 0.0
    for s in tarea.get("sessions") or []:
        try:
            ini = _aware(s["start"])
            fin = _aware(s["end"]) if s.get("end") else datetime.now(timezone.utc)
        except (KeyError, ValueError, TypeError):
            continue
        if desde:
            ini = max(ini, desde)
        if hasta:
            fin = min(fin, hasta)
        total += max(0.0, (fin - ini).total_seconds())
    return total


def humano(seg: float) -> str:
    m = int(round(seg / 60))
    h, m = divmod(m, 60)
    return (f"{h}h " if h else "") + f"{m}m"


def lunes(offset: int = 0) -> datetime:
    hoy = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return hoy - timedelta(days=hoy.weekday()) + timedelta(days=7 * offset)


def semana_iso(d: datetime):
    ao, sem, _ = d.isocalendar()
    return ao, sem


def guardar(data: dict) -> None:
    escribir(data)


# --------------------------------------------------------------------------- comandos


def cmd_ver(data, args):
    tareas = data["tasks"]
    corriendo = (data.get("timer") or {}).get("taskId")
    hubo = False
    for col, nombre in COLUMNAS:
        if col == "done" and not args.todas:
            continue
        de_col = [t for t in tareas if t.get("column") == col]
        if not de_col:
            continue
        hubo = True
        print(f"\n{nombre}")
        for t in de_col:
            subs = t.get("subtasks") or []
            hechas = sum(1 for s in subs if s.get("done"))
            extra = []
            if t.get("project"):
                extra.append(t["project"])
            if subs:
                extra.append(f"{hechas}/{len(subs)} subtareas")
            if t.get("kind") == "side":
                extra.append("secundaria")
            if t["id"] == corriendo:
                extra.append("CRONÓMETRO CORRIENDO")
            cola = ("  ·  " + " · ".join(extra)) if extra else ""
            print(f"  {t['id']}  {_hm(segundos(t))}  {t.get('title', '')}{cola}")
            for i, s in enumerate(subs, 1):
                print(f"      {i}. [{'x' if s.get('done') else ' '}] {s.get('title', '')}")
            if t.get("note"):
                print(f"      nota: {t['note']}")
    if not hubo:
        print("La bitácora está vacía.")
    pendientes = [r for r in data["reminders"] if not r.get("done")]
    if pendientes:
        print("\nRecordatorios")
        for r in sorted(pendientes, key=lambda x: str(x.get("at", ""))):
            print(f"  {r.get('at', '')}  {r.get('text', '')}")
    print()


def cmd_add(data, args):
    tarea = {
        "id": nuevo_id(),
        "title": args.titulo,
        "kind": args.tipo,
        "project": args.proyecto or "",
        "column": args.col,
        "priority": args.prioridad,
        "note": args.nota or "",
        "subtasks": [],
        "sessions": [],
        "createdAt": ahora_utc(),
        "done": args.col == "done",
    }
    data["tasks"].insert(0, tarea)
    guardar(data)
    print(f"Añadida {tarea['id']}: {tarea['title']}")


def cmd_sub(data, args):
    t = buscar(data, args.id)
    t.setdefault("subtasks", []).append({"id": nuevo_id(), "title": args.titulo, "done": False})
    guardar(data)
    print(f"Subtarea añadida a {t['id']}: {args.titulo}")


def cmd_check(data, args):
    t = buscar(data, args.id)
    subs = t.get("subtasks") or []
    if not 1 <= args.numero <= len(subs):
        sys.exit(f"{t['id']} tiene {len(subs)} subtareas; pediste la {args.numero}.")
    s = subs[args.numero - 1]
    s["done"] = not s.get("done")
    guardar(data)
    print(f"{'Cerrada' if s['done'] else 'Reabierta'}: {s['title']}")


def _mover(data, t, col):
    if t.get("column") == col:
        return
    data.setdefault("moves", []).append({
        "id": nuevo_id(), "taskId": t["id"], "title": t.get("title", ""),
        "from": t.get("column"), "to": col, "at": ahora_utc(),
    })
    t["column"] = col
    if col == "done":
        t["done"] = True
        t["doneAt"] = ahora_utc()
        if (data.get("timer") or {}).get("taskId") == t["id"]:
            data["timer"] = None
    else:
        t["done"] = False
        t["doneAt"] = None


def cmd_mover(data, args):
    t = buscar(data, args.id)
    _mover(data, t, args.columna)
    guardar(data)
    print(f"{t['title']} → {NOMBRE_COL[args.columna]}")


def cmd_cerrar(data, args):
    t = buscar(data, args.id)
    _mover(data, t, "done")
    guardar(data)
    print(f"Cerrada: {t['title']}  ({humano(segundos(t))} en total)")


def cmd_tiempo(data, args):
    t = buscar(data, args.id)
    if args.minutos < 1:
        sys.exit("Los minutos tienen que ser al menos 1.")
    fin = datetime.now().astimezone()
    if args.fin:
        try:
            hh, mm = (int(x) for x in args.fin.split(":"))
            fin = fin.replace(hour=hh, minute=mm, second=0, microsecond=0)
        except ValueError:
            sys.exit("--fin va como HH:MM, por ejemplo 17:30.")
    ini = fin - timedelta(minutes=args.minutos)
    t.setdefault("sessions", []).append({
        "id": nuevo_id(),
        "start": ini.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "end": fin.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "manual": True,
    })
    guardar(data)
    print(f"{args.minutos} min a «{t['title']}» → {humano(segundos(t))} en total")


def cmd_nota(data, args):
    t = buscar(data, args.id)
    t["note"] = args.texto
    guardar(data)
    print(f"Nota guardada en {t['id']}")


def cmd_recordar(data, args):
    try:
        cuando = datetime.fromisoformat(args.cuando.replace(" ", "T"))
    except ValueError:
        sys.exit('--cuando va como "2026-09-25 17:00".')
    rec = {
        "id": nuevo_id(),
        "text": args.texto,
        "at": cuando.strftime("%Y-%m-%dT%H:%M"),
        "repeat": args.repite,
        "taskId": args.tarea or "",
        "startTimer": False,
        "done": False,
    }
    data["reminders"].append(rec)
    guardar(data)
    print(f"Recordatorio para {rec['at']}: {rec['text']}")


def cmd_semana(data, args):
    ini = lunes(args.offset)
    fin = ini + timedelta(days=7)
    ultimo = ini + timedelta(days=6)
    ao, sem = semana_iso(ini)
    inc = (data.get("ui") or {}).get("includes") or {}

    dias = []
    for i in range(7):
        d0 = ini + timedelta(days=i)
        d1 = d0 + timedelta(days=1)
        pri = sum(segundos(t, d0, d1) for t in data["tasks"] if t.get("kind") == "main")
        sec = sum(segundos(t, d0, d1) for t in data["tasks"] if t.get("kind") != "main")
        if pri + sec < 60:
            pri = sec = 0.0
        dias.append((d0, pri, sec))
    pri_total = sum(d[1] for d in dias)
    sec_total = sum(d[2] for d in dias)
    total = pri_total + sec_total

    def en_semana(t):
        if segundos(t, ini, fin) > 0:
            return True
        if t.get("doneAt"):
            try:
                return ini <= _aware(t["doneAt"]).astimezone() < fin
            except (ValueError, TypeError):
                return False
        return False

    dentro = [t for t in data["tasks"] if en_semana(t)]
    rango = (f"{ini.day} al {ultimo.day} de {MESES[ultimo.month - 1]}"
             if ini.month == ultimo.month else
             f"{ini.day} de {MESES[ini.month - 1]} al {ultimo.day} de {MESES[ultimo.month - 1]}")

    L = ["---", "tipo: bitacora-semanal", f"semana: {ao}-W{sem:02d}",
         f"rango: {ini:%Y-%m-%d} / {ultimo:%Y-%m-%d}",
         f"corte: {datetime.now():%Y-%m-%dT%H:%M}"]
    autor = ((data.get("settings") or {}).get("author") or "").strip()
    if autor:
        L.append(f"autor: {autor}")
    L += [f"total: {humano(total)}", "---", "", f"# Semana {sem} — {rango}", "", "## Tiempos",
          f"- Principales: {humano(pri_total)}" +
          (f" ({round(pri_total / total * 100)}%)" if total else ""),
          f"- Secundarias: {humano(sec_total)}" +
          (f" ({round(sec_total / total * 100)}%)" if total else ""),
          f"- Días con registro: {sum(1 for d in dias if d[1] + d[2] > 0)} de 7"]
    for d0, pri, sec in dias:
        if pri + sec > 0:
            L.append(f"- {DIAS[d0.weekday()]} {d0:%Y-%m-%d}: {humano(pri + sec)}")
    L.append("")

    L.append("## Tareas principales")
    principales = [t for t in dentro if t.get("kind") == "main"]
    if not principales:
        L.append("_Sin tareas principales registradas._")
    for t in principales:
        subs = t.get("subtasks") or []
        L += ["", f"### {t.get('title', '')}"]
        if t.get("project"):
            L.append(f"- proyecto: {t['project']}")
        L.append(f"- estado: {NOMBRE_COL.get(t.get('column'), t.get('column'))}")
        L.append(f"- tiempo en la semana: {humano(segundos(t, ini, fin))}")
        L.append(f"- tiempo acumulado: {humano(segundos(t))}")
        if subs:
            L.append(f"- subtareas: {sum(1 for s in subs if s.get('done'))} de {len(subs)} cerradas")
            for s in subs:
                L.append(f"  - [{'x' if s.get('done') else ' '}] {s.get('title', '')}")
        sesiones = []
        for s in t.get("sessions") or []:
            try:
                a, b = _aware(s["start"]).astimezone(), _aware(s["end"]).astimezone()
            except (KeyError, ValueError, TypeError):
                continue
            if b <= ini or a >= fin:
                continue
            sesiones.append(f"{DIAS[a.weekday()]} {a:%H:%M}–{b:%H:%M}")
        if sesiones:
            L.append("- sesiones: " + "; ".join(sesiones))
        if t.get("note"):
            L.append("- nota: " + " / ".join(t["note"].split("\n")))
    L.append("")

    if inc.get("side", True):
        L.append("## Tareas secundarias")
        secundarias = [t for t in dentro if t.get("kind") != "main"]
        if not secundarias:
            L.append("_Sin tareas secundarias._")
        for t in secundarias:
            L.append(f"- {t.get('title', '')} — {humano(segundos(t, ini, fin))}" +
                     (f" ({t['project']})" if t.get("project") else "") +
                     (" · cerrada" if t.get("done") else ""))
        L.append("")

    if inc.get("board", True):
        L.append("## Movimientos del tablero")
        movs = []
        for m in data.get("moves") or []:
            try:
                cuando = _aware(m["at"]).astimezone()
            except (KeyError, ValueError, TypeError):
                continue
            if ini <= cuando < fin:
                movs.append(f"- {m.get('title', '')}: {NOMBRE_COL.get(m.get('from'), m.get('from'))}"
                            f" → {NOMBRE_COL.get(m.get('to'), m.get('to'))}"
                            f" ({DIAS[cuando.weekday()]} {cuando:%H:%M})")
        L += movs or ["_Sin movimientos._"]
        L.append("")

    if inc.get("prompt", True):
        L += ["## Qué necesito", PROMPT, ""]

    texto = "\n".join(L)
    if args.salida:
        Path(args.salida).write_text(texto, encoding="utf-8")
        print(f"Escrito en {args.salida}")
    else:
        print(texto)


# --------------------------------------------------------------------------- cli


def main():
    ap = argparse.ArgumentParser(description=f"Bitácora sobre {REL}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("ver", help="listar tareas y recordatorios")
    p.add_argument("--todas", action="store_true", help="incluir las cerradas")
    p.set_defaults(func=cmd_ver)

    p = sub.add_parser("add", help="añadir una tarea")
    p.add_argument("titulo")
    p.add_argument("--tipo", choices=["main", "side"], default="main")
    p.add_argument("--proyecto")
    p.add_argument("--col", choices=[c for c, _ in COLUMNAS], default="todo")
    p.add_argument("--prioridad", choices=["baja", "normal", "alta"], default="normal")
    p.add_argument("--nota")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("sub", help="añadir una subtarea")
    p.add_argument("id")
    p.add_argument("titulo")
    p.set_defaults(func=cmd_sub)

    p = sub.add_parser("check", help="cerrar o reabrir la subtarea número N")
    p.add_argument("id")
    p.add_argument("numero", type=int)
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("mover", help="mover de columna")
    p.add_argument("id")
    p.add_argument("columna", choices=[c for c, _ in COLUMNAS])
    p.set_defaults(func=cmd_mover)

    p = sub.add_parser("cerrar", help="mover a Hecho")
    p.add_argument("id")
    p.set_defaults(func=cmd_cerrar)

    p = sub.add_parser("tiempo", help="sumar minutos trabajados")
    p.add_argument("id")
    p.add_argument("minutos", type=int)
    p.add_argument("--fin", help="hora de término, HH:MM (por defecto, ahora)")
    p.set_defaults(func=cmd_tiempo)

    p = sub.add_parser("nota", help="escribir la nota de una tarea")
    p.add_argument("id")
    p.add_argument("texto")
    p.set_defaults(func=cmd_nota)

    p = sub.add_parser("recordar", help="crear un recordatorio")
    p.add_argument("texto")
    p.add_argument("--cuando", required=True, help='"2026-09-25 17:00"')
    p.add_argument("--repite", choices=REPETICIONES, default="once")
    p.add_argument("--tarea", help="id de la tarea vinculada")
    p.set_defaults(func=cmd_recordar)

    p = sub.add_parser("semana", help="generar el archivo semanal para Claude")
    p.add_argument("--offset", type=int, default=0, help="-1 la semana pasada")
    p.add_argument("--salida", help="escribir a un archivo en vez de la pantalla")
    p.set_defaults(func=cmd_semana)

    args = ap.parse_args()
    try:
        data = leer()
    except ValueError as err:
        sys.exit(str(err))
    args.func(data, args)


if __name__ == "__main__":
    main()
