# Generador de Bitácoras

App web para llevar bitácora de trabajo: cronómetro, tareas principales y secundarias,
recordatorios, tablero kanban y modo oscuro. El objetivo final es exportar un archivo
que Claude pueda leer para escribir el resumen ejecutivo de la semana.

Estado actual: **app funcionando**. Sin build, sin dependencias, sin servidor: abre
`index.html` en el navegador (doble clic o cualquier hosting estático) y ya está.
El diseño previo sigue en `design/project/` como referencia.

## Archivos

- `index.html` — el armazón de la app.
- `app.css` — tokens de color (claro/oscuro), tipografía y componentes.
- `app.js` — estado, cronómetro, tablero, recordatorios y generación del export.
- `tools/build-artifact.py` — genera `dist/page.html` para publicarla como Artifact.

## Qué hace

- **Cronómetro**: uno a la vez, con las sesiones guardadas por tarea. Sobrevive a recargas.
  Arrancar una tarea de *Por hacer* la mueve sola a *En curso*.
- **Tareas principales** con proyecto, prioridad, subtareas, notas, sesiones editables y
  tiempo manual para lo que se te olvidó cronometrar.
- **Tareas secundarias** para interrupciones y apoyo, con su propio total.
- **Kanban** de cuatro columnas con arrastrar y soltar, y botones ← → para teclado y móvil.
  Cada movimiento queda registrado con su hora.
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

- **Tarea principal**: título, proyecto, estado kanban, subtareas, sesiones de cronómetro.
- **Tarea secundaria**: título, etiqueta, tiempo, hecha/no hecha. No ocupa tarjeta propia.
- **Sesión**: `inicio`, `fin`, `tarea_id`. El tiempo nunca se escribe a mano.
- **Recordatorio**: texto, fecha/hora, repetición, tarea vinculada, si arranca el cronómetro.
- **Movimiento de tablero**: tarjeta, columna origen, columna destino, timestamp.

## Despliegue en GitHub Pages

El workflow `.github/workflows/pages.yml` copia `index.html`, `app.css` y `app.js` a `_site`
y los despliega. Corre en cada push a la rama por defecto y también a mano desde la pestaña
Actions.

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
