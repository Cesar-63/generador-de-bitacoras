# Generador de Bitácoras

App web para llevar bitácora de trabajo: cronómetro, tareas principales y secundarias,
recordatorios, tablero kanban y modo oscuro. El objetivo final es exportar un archivo
que Claude pueda leer para escribir el resumen ejecutivo de la semana.

Estado actual: **app funcionando**, sin build y sin dependencias.

## Dos formas de usarla

**En la web** — https://cesar-63.github.io/generador-de-bitacoras/ o abriendo
`index.html` con doble clic. Guarda en el `localStorage` del navegador.

**En local, sobre un archivo** — `python3 tools/serve.py` y abre
http://127.0.0.1:4321. Ahí la bitácora vive en `data/bitacora.json`, un archivo
de texto que puedes editar tú, con la CLI, o pedirle a Claude que edite si tiene
acceso a la carpeta. La app recoge los cambios del archivo en ~2,5 segundos.

La app elige el modo sola: pregunta por `api/state` al arrancar y, si nadie
responde, se queda en el navegador. `data/` está en `.gitignore`: es tu registro
de trabajo y el repositorio es público.

```bash
python3 tools/serve.py                              # la app sobre el archivo
python3 tools/bitacora.py ver                       # listar desde la terminal
python3 tools/bitacora.py epica add "Facturación electrónica"
python3 tools/bitacora.py historia "Como cliente quiero X" --epica FACT
python3 tools/bitacora.py add "Título" --proyecto Atlas --historia HU-1
python3 tools/bitacora.py tiempo <id> 45            # sumar 45 minutos
python3 tools/bitacora.py cerrar <id>
python3 tools/bitacora.py semana                    # el markdown para Claude
```

`CLAUDE.md` tiene el esquema del archivo y las reglas para editarlo sin romper
nada; es lo que lee Claude al abrir la carpeta.

## Archivos

- `index.html` — el armazón de la app.
- `app.css` — tokens de color (claro/oscuro), tipografía y componentes.
- `app.js` — estado, cronómetro, tablero, recordatorios y generación del export.
- `tools/serve.py` — servidor local que guarda en `data/bitacora.json`.
- `tools/bitacora.py` — CLI para manejar la bitácora sin abrir el navegador.
- `tools/build-artifact.py` — genera `dist/page.html` para publicarla como Artifact.
- `design/project/` — el diseño previo, como referencia.

## Qué hace

- **Cronómetro**: uno a la vez, con las sesiones guardadas por tarea. Sobrevive a recargas.
  Arrancar una tarea de *Por hacer* la mueve sola a *En curso*.
- **Tareas principales** con proyecto, prioridad, subtareas, notas, sesiones editables y
  tiempo manual para lo que se te olvidó cronometrar.
- **Tareas secundarias** para interrupciones y apoyo, con su propio total.
- **Kanban** de cuatro columnas con arrastrar y soltar, y botones ← → para teclado y móvil.
  Cada movimiento queda registrado con su hora. Se puede filtrar por épica o etiqueta.
- **Backlog**: épicas → historias de usuario → tareas, con el tiempo y el avance
  acumulados en cada nivel. Las etiquetas son planas y transversales (`bug`,
  `deuda-tecnica`), y se filtran con un clic desde cualquier chip.
- **Recordatorios** con repetición (una vez, diario, días hábiles, semanal), vinculables a
  una tarea y capaces de arrancar el cronómetro al avisar. Usan las notificaciones del
  navegador si les das permiso; si no, avisan dentro de la app.
- **Semana**: tiempo por día, totales, y el panel de exportación en Markdown o JSON.
- **Modo oscuro** (auto, claro u oscuro) y cuatro colores de acento.
- **Copia de seguridad**: descarga y restaura todo en un `.json`.

## Pantallas

| Artboard | Pantalla |
| --- | --- |
| `Main.dc.html` | Hoy — cronómetro en curso, tareas principales y secundarias, recordatorios (claro) |
| `Oscuro.dc.html` | La misma pantalla en modo oscuro |
| `Kanban.dc.html` | Tablero de 4 columnas con tiempo acumulado por tarjeta |
| `Semana.dc.html` | Resumen semanal y panel de exportación para Claude |
| `Recordatorios.dc.html` | Alta de recordatorio con repetición y vínculo a tarea |
| `Movil.dc.html` | Captura rápida en móvil (390×844) |

## Modelo de datos previsto

- **Épica**: clave corta (`FACT`), título, nota. Agrupa historias.
- **Historia de usuario**: clave (`HU-7`), épica a la que pertenece, criterios de aceptación.
- **Tarea principal**: título, proyecto, estado kanban, subtareas, sesiones de cronómetro,
  etiquetas, y la historia o épica de la que cuelga.
- **Tarea secundaria**: título, etiqueta, tiempo, hecha/no hecha. No ocupa tarjeta propia.
- **Sesión**: `inicio`, `fin`, `tarea_id`. El tiempo nunca se escribe a mano.
- **Recordatorio**: texto, fecha/hora, repetición, tarea vinculada, si arranca el cronómetro.
- **Movimiento de tablero**: tarjeta, columna origen, columna destino, timestamp.

## Despliegue en GitHub Pages

El workflow `.github/workflows/pages.yml` copia `index.html`, `app.css` y `app.js` a `_site`
y los despliega. Corre en cada push a `main` y también a mano desde la pestaña Actions.
El trabajo va en ramas aparte y llega al sitio publicado al fusionarse en `main`.

**Un paso manual la primera vez**: GitHub no deja que el workflow cree el sitio por su
cuenta (`Resource not accessible by integration`). En **Settings → Pages → Build and
deployment → Source**, elige **GitHub Actions**. Después de eso el workflow despliega solo.

Si aun así falla con un error de permisos, revisa **Settings → Actions → General → Workflow
permissions** y déjalo en *Read and write permissions*.

La URL queda en https://cesar-63.github.io/generador-de-bitacoras/

## Formato de exportación

Un `.md` por semana (`bitacora-2026-W39.md`) con front-matter YAML y secciones fijas, más
el equivalente en JSON para uso programático. Estructura del markdown:

```
---
tipo: bitacora-semanal
semana: 2026-W39
rango: 2026-09-21 / 2026-09-25
corte: 2026-09-22T15:02
total: 11h06m
---

# Semana 39 — 21 al 25 de septiembre
## Tiempos
## Tareas principales      (una subsección por tarea: proyecto, estado, tiempo, subtareas, sesiones, notas)
## Tareas secundarias
## Movimientos del tablero
## Recordatorios cumplidos
```

El archivo se acompaña de un prompt fijo que pide el resumen ejecutivo (logros, tiempo por
proyecto, bloqueos y pendientes).

## Secrets

Nada por ahora: la app es local al navegador y el export se descarga o se copia. Sólo haría
falta una `ANTHROPIC_API_KEY` si la app generara el resumen por su cuenta, y esa llamada
tendría que salir de un backend, nunca del navegador.
