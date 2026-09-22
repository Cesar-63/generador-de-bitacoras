#!/usr/bin/env python3
"""Genera dist/page.html: la misma app, sin el esqueleto <html>/<head>/<body>,
para publicarla como Artifact (el publicador añade ese esqueleto)."""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'index.html').read_text(encoding='utf-8')

body = re.search(r'<body>(.*)</body>', src, re.S).group(1).strip()
fonts = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', src).group(0)

out = '\n'.join([
    '<title>Generador de Bitácoras</title>',
    fonts,
    '<link rel="stylesheet" href="app.css">',
    '',
    body,
    '',
])
dist = root / 'dist'
dist.mkdir(exist_ok=True)
(dist / 'page.html').write_text(out, encoding='utf-8')
print('dist/page.html escrito:', len(out), 'bytes')
