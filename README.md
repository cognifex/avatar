# Deadpan Comedy Avatar v1

Sehr einfacher 2D-Avatar für Streaming mit Deadpan-Basis und kurzen Expression-Peaks.

## Scope v1

- Webcam-Start und Status-Flow (No Camera / Low Light-Face Lost / Tracking OK / Live)
- 5 Emotionen mit Normalisierung: neutral, joy, annoyed, surprise, skeptical
- 3 Style-Profile: Deadpan, Balanced, Overreact
- Canvas-Output mit transparentem Hintergrund (OBS-ready)
- Peak-Engine mit kurzem Hold + Cooldown

## Start

```bash
python3 -m http.server
```

Dann `http://localhost:8000` öffnen.

## Hinweis

In dieser v1 ist die Tracking-Pipeline als strukturierter Platzhalter umgesetzt (`updateMockTracking`), damit Emotion-Solver, Timing, Profile und Renderer bereits integriert getestet werden können. Austausch gegen MediaPipe Face Landmarker ist als nächster Schritt vorgesehen.
