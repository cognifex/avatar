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
- Separater Kamera-Tracking-Pfad (Frontkamera) mit Fallback auf Zeichen-Heuristik

## Nutzung

1. `index.html` im Browser öffnen (empfohlen per lokalem Webserver, z. B. `python3 -m http.server`).
2. Beim ersten Start Kamera-Berechtigung erlauben (für Face Tracking) und optional Mikrofon-Berechtigung für Audio-Animation.
3. Links Avatar zeichnen.
4. **Gesicht erkennen** klicken und die markierte Box prüfen.
5. **In Output übernehmen** klicken.
6. Optional: **Mikrofon starten** für zusätzliche Audio-Animation.

## Kamera-Berechtigung & Status

- **Kamera nicht erlaubt:** Tracking kann nicht aus dem Videobild lesen; Browser-Permission prüfen.
- **Kein Gesicht im Kamerabild:** Kamera läuft, aber es wurde aktuell kein Gesicht stabil erkannt.
- **Tracking aktiv:** Gesicht wird erkannt, Pose/Landmarks fließen in den Renderpfad ein.

## Browser-Kompatibilität

- Benötigt einen modernen Browser mit `getUserMedia` (aktuelle Versionen von Chrome, Edge, Firefox, Safari).
- Für Safari/iOS ist HTTPS oder `localhost` für Kamera/Mikrofon-Zugriff erforderlich.
- Bei restriktiven Privacy-Settings kann Face Tracking blockiert werden, selbst wenn die Seite geladen ist.

## Wichtiger Hinweis

- Der neutrale Zustand im Output bleibt dein original gezeichnetes Gesicht.
- Die Animation nutzt diesen gezeichneten Gesichtsausschnitt, statt ein vordefiniertes Cartoon-Gesicht zu zeichnen.
