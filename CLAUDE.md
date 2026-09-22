# Instrucciones para Claude

Esta carpeta es la bitácora de trabajo de César. El uso habitual es que **Claude
administre las tareas** desde aquí mientras la app está abierta en el navegador.

## Dónde están los datos

`data/bitacora.json` es la **fuente de verdad**. Un solo archivo JSON con todo:
tareas, sesiones de cronómetro, movimientos del tablero y recordatorios.

- `data/bitacora.md` es un **espejo generado**: se reescribe entero en cada
  guardado. Sírvete de él para mirar el estado de un vistazo, pero no lo edites:
  los cambios se pierden.
- `data/` está en `.gitignore` **a propósito**: el repositorio es público y esto
  es el registro de trabajo de una persona. No lo subas nunca, ni lo pegues en
  un commit, issue o PR.
- Si la app está abierta, recoge los cambios del archivo sola en ~2,5 segundos.

## Cómo cambiar cosas

Prefiere la CLI: valida el esquema, genera los ids y regenera el espejo.

```bash
python3 tools/bitacora.py ver                       # listar con ids
python3 tools/bitacora.py ver --todas               # incluidas las cerradas
python3 tools/bitacora.py add "Título" --proyecto Atlas [--tipo main|side]
python3 tools/bitacora.py sub <id> "Subtarea"
python3 tools/bitacora.py check <id> 2              # cierra/reabre la subtarea 2
python3 tools/bitacora.py tiempo <id> 45            # suma 45 min (--fin 17:30)
python3 tools/bitacora.py mover <id> review
python3 tools/bitacora.py cerrar <id>
python3 tools/bitacora.py nota <id> "Bloqueado por X"
python3 tools/bitacora.py recordar "Enviar avance" --cuando "2026-09-25 17:00" \
    --repite weekdays
python3 tools/bitacora.py semana [--offset -1] [--salida bitacora.md]
```

Los ids admiten prefijo mientras no sea ambiguo. Para lo que la CLI no cubre
(renombrar, reordenar, corregir a mano) edita el JSON directamente respetando el
esquema de abajo.

## Esquema de `data/bitacora.json`

```jsonc
{
  "version": 1,
  "settings": { "theme": "system|light|dark", "accent": "clay|teal|indigo|ink", "author": "" },
  "ui": { "view": "hoy", "weekOffset": 0, "tab": "md",
          "includes": { "side": true, "board": true, "reminders": true, "prompt": true } },
  "tasks": [{
    "id": "a1b2c3d4e5",            // único; cualquier cadena estable sirve
    "title": "Migrar endpoints",
    "kind": "main",                 // "main" = principal, "side" = secundaria
    "project": "Atlas",             // texto libre, puede ir vacío
    "column": "todo",               // todo | doing | review | done
    "priority": "normal",           // baja | normal | alta
    "note": "",                     // se copia al resumen semanal
    "subtasks": [{ "id": "…", "title": "…", "done": false }],
    "sessions": [{ "id": "…", "start": "2026-09-22T12:10:00Z", "end": "2026-09-22T13:25:00Z" }],
    "createdAt": "2026-09-21T09:00:00Z",
    "done": false,
    "doneAt": null
  }],
  "reminders": [{
    "id": "…", "text": "Cerrar la bitácora", "at": "2026-09-25T17:30",
    "repeat": "once|daily|weekdays|weekly", "taskId": "", "startTimer": false, "done": false
  }],
  "moves": [{ "id": "…", "taskId": "…", "title": "…", "from": "doing", "to": "done",
              "at": "2026-09-22T14:00:00Z" }],
  "timer": { "taskId": "…", "startedAt": "2026-09-22T14:05:00Z" }
}
```

**Dos formatos de fecha, y no son intercambiables:**

- `sessions`, `createdAt`, `doneAt`, `moves[].at`, `timer.startedAt` → ISO en
  **UTC**, terminado en `Z`.
- `reminders[].at` → hora **local sin zona**, `YYYY-MM-DDTHH:MM`. Así se dispara
  a las 17:30 de quien mira, no a las 17:30 UTC.

## Reglas

1. **No inventes tiempo.** Las `sessions` son el registro de lo que realmente se
   trabajó y alimentan el resumen semanal. Si no sabes cuánto duró algo,
   pregunta; no estimes.
2. **No toques `timer`** salvo para detenerlo (ponerlo en `null`). Si una tarea
   con el cronómetro corriendo se cierra, para el cronómetro en el mismo cambio.
3. **Un movimiento de columna es un evento**: si cambias `column`, añade la
   entrada correspondiente en `moves`. La CLI ya lo hace.
4. **Cerrar** = `column: "done"`, `done: true` y `doneAt` con la hora. Otra vez:
   la CLI lo hace.
5. Si el JSON queda malformado, la app y el servidor fallan con un error claro,
   pero nadie recupera lo perdido: valida antes de escribir
   (`python3 -m json.tool data/bitacora.json > /dev/null`).

## El resumen semanal

El objetivo del proyecto. `python3 tools/bitacora.py semana` escribe el mismo
markdown que exporta la app: front-matter con semana y totales, una sección por
tarea principal con sus sesiones y subtareas, secundarias, movimientos del
tablero y la instrucción final. Cuando pida el resumen ejecutivo, genera ese
archivo y trabaja sobre él en vez de leer el JSON crudo.

## La app

```bash
python3 tools/serve.py          # http://127.0.0.1:4321
```

Sirve la carpeta y expone `GET/PUT /api/state` sobre `data/bitacora.json`. Sólo
escucha en 127.0.0.1. Sin el servidor (GitHub Pages, o abriendo `index.html` con
doble clic) la app guarda en `localStorage` y este archivo no interviene.

Si la app y tú escriben a la vez, el servidor rechaza el guardado de la app con
un 409 en lugar de pisar tu edición; la app recarga el disco y avisa. Tus
cambios en el archivo siempre ganan.

## El código

`index.html` + `app.css` + `app.js`, sin build ni dependencias, JavaScript
clásico (nada de módulos, para que funcione también con `file://`). `app.js`
decide el modo de guardado al arrancar en `probeFile()`. Cambios en esos tres
archivos se publican solos en GitHub Pages al hacer push.
