# Generador de Bitácoras

App web para llevar bitácora de trabajo: cronómetro, tareas principales y secundarias,
recordatorios, tablero kanban y modo oscuro. El objetivo final es exportar un archivo
que Claude pueda leer para escribir el resumen ejecutivo de la semana.

Estado actual: **diseño de la interfaz**, publicado como canvas de artboards interactivos.
Las fuentes viven en `design/project/` (`canvas.json` es el índice; cada `.dc.html` es una
pantalla).

## Pantallas

| Archivo | Pantalla |
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
