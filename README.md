# Avatar Audio Canvas Tool

Ein Browser-Tool, mit dem du links einen Avatar zeichnest und rechts einen separaten Output für OBS bekommst.

## Features

- **2 Canvas-Flächen:**
  - Zeichen-Canvas (Input)
  - Output-Canvas (für OBS)
- Heuristische Gesichtserkennung + sichtbare Markierung des erkannten Bereichs
- Übernahme deiner Zeichnung in den Output (neutraler Ausdruck = exakt deine Zeichnung)
- Mikrofonanalyse und Animation auf Basis deines gezeichneten Gesichts
- Transparenter Output-Hintergrund für OBS Browser Source

## Nutzung

1. `index.html` im Browser öffnen (direkt per Doppelklick funktioniert; alternativ per lokalem Webserver).
2. Links Avatar zeichnen.
3. **Gesicht erkennen** klicken und die markierte Box prüfen.
4. **In Output übernehmen** klicken.
5. Optional: **Mikrofon starten** für Animation.

## Wichtiger Hinweis

- Der neutrale Zustand im Output bleibt dein original gezeichnetes Gesicht.
- Die Animation nutzt diesen gezeichneten Gesichtsausschnitt, statt ein vordefiniertes Cartoon-Gesicht zu zeichnen.
