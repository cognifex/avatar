# Avatar Audio Canvas Tool

Ein einfaches Browser-Tool, um einen gezeichneten Avatar (z. B. Strichmännchen) auf Sprache reagieren zu lassen.

## Features

- Freies Zeichnen auf einem Canvas
- Heuristische Erkennung der Gesichtsposition aus der Zeichnung
- Mikrofonanalyse (Lautstärke + grobe Pitch-Schätzung)
- Mimik-Overlay (Augen + Mund) mit Audio-reaktiver Lippenbewegung
- Transparenter Hintergrund-Modus für OBS Browser Source

## Nutzung

1. `index.html` im Browser öffnen (direkt per Doppelklick funktioniert; alternativ per lokalem Webserver).
2. Avatar zeichnen.
3. **Gesicht erkennen** klicken.
4. **Mikrofon starten** klicken und Berechtigung erlauben.
5. In OBS als Browser Source einbinden.

## OBS-Hinweis

- Aktiviere in der App `Transparenter Hintergrund`, wenn du die Quelle über dein Stream-Layout legen willst.
- Stelle in OBS dieselbe Auflösung wie im Canvas ein (960x540), falls du 1:1 Pixel möchtest.
