# Draw Time Estimation Design

## Goal

Die App soll die Gesamt-Zeichenzeit des aktuell sichtbaren Motivs dauerhaft in der UI anzeigen. Die Schätzung soll sich an real gemessenen Laufzeiten bereits gezeichneter Striche orientieren und sich bei zukünftigen Draw-Runs laufend an ein schnelleres oder langsameres Gerät anpassen.

## Chosen Approach

1. Die geometrische Basis-Schätzung bleibt deterministisch und nutzt dieselbe Stroke-zu-Maschinenpfad-Logik wie der eigentliche Draw-Run.
2. Zusätzlich wird ein lokal persistiertes Timing-Profil gepflegt, das aus echten Stroke-Laufzeiten einen Kalibrierungsfaktor ableitet.
3. Die sichtbare Gesamtzeit für das aktuelle Motiv wird als `Basis-Schätzung * Kalibrierungsfaktor` berechnet.
4. Das Timing-Profil wird bot-lokal in `localStorage` gespeichert, damit es projektübergreifend erhalten bleibt und nicht durch ältere Projektdateien überschrieben wird.

## Data Model

Das Timing-Profil speichert nur die für die Schätzung nötigen, stabilen Daten:

- `schemaVersion`
- `updatedAt`
- `strokeSampleCount`
- `durationScale`

`durationScale` ist ein geglätteter Faktor aus `actualStrokeMs / estimatedStrokeMs`. Neue Messungen werden als gleitender Durchschnitt mit stärkerem Gewicht auf neuere Striche eingearbeitet.

## Integration Points

- `EggBotSerial.mjs`
  - meldet nach jedem abgeschlossenen Strich echte und geschätzte Stroke-Dauer zurück
- `AppControllerRuntime.mjs`
  - lädt und speichert das Timing-Profil dauerhaft
- `AppControllerDraw.mjs`
  - aktualisiert das Timing-Profil während Draw-Runs
- `AppControllerRender.mjs`
  - berechnet die sichtbare Gesamtzeit aus aktuellen Strokes und Profil
- `src/index.html`, `src/AppElements.mjs`, `src/i18n/*.json`
  - neue dauerhafte UI-Anzeige

## Error Handling

- Ohne Messdaten wird mit Faktor `1` gearbeitet.
- Ungültige oder fehlende Persistenzdaten werden auf das Default-Profil zurückgesetzt.
- Wenn eine Timing-Schätzung für das aktuelle Motiv nicht möglich ist, zeigt die UI `--:--`.

## Testing

- Utility-Tests für Profil-Normalisierung und Kalibrierung
- Serial-Test für Stroke-Mess-Callbacks
- Controller/UI-Tests für die neue Anzeige und Persistenz
