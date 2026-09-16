# tau

Ein schlichter Editor für Typst. Dateibaum links, Tabs oben, Quelltext in der
Mitte, gerenderte Seiten rechts.

## Starten

```bash
bun run tauri dev
```

Zum Bauen eines Installationspakets: `bun run tauri build`.

## Wie es funktioniert

Das Rendern übernimmt [tinymist](https://github.com/Myriad-Dreamin/tinymist) —
dasselbe Programm, das auch die Typst-Erweiterungen für VS Code und Zed
antreibt. Es liegt als Sidecar in `src-tauri/bin/` und wird beim Öffnen eines
Dokuments gestartet. Von ihm kommen:

- die gerenderten Seiten, als eigenes Web-Frontend im `<iframe>` rechts
- die Gliederung in der Seitenleiste, inklusive Überschriften aus eingebundenen
  Dateien
- der Kompilierstatus in der Fußzeile

Editor und Vorschau sprechen über ein WebSocket-Protokoll mit fünf Nachrichten
(`src/preview.ts`). Die wichtigste ist `updateMemoryFiles`: sie schickt den
Pufferinhalt, sodass die Vorschau beim Tippen mitläuft, ohne dass gespeichert
werden muss. Strg+S schreibt nur auf die Platte.

## Bedienung

| Taste | Wirkung |
|---|---|
| Strg+S | speichern |
| Strg+P | Datei suchen und öffnen |
| Strg+W | Tab schließen |
| Strg+Leertaste | Vervollständigung (Symbole, Funktionen, Mathe) |
| Strg+N | neue Datei anlegen (ohne Endung wird `.typ` ergänzt) |
| Strg+Shift+P | Befehle: Datei anlegen, Literaturdatei, Bilder aufnehmen, Ordner öffnen … |
| Mausrad über der Tab-Leiste | rollt sie waagerecht, wenn viele Tabs offen sind |
| Klick in die Vorschau | springt an die passende Stelle im Quelltext |
| Strg+V mit Bild | legt die Datei unter `assets/` ab und fügt `#image(...)` ein |

Der Cursor im Editor zieht die Vorschau mit; ein Klick in die Vorschau zieht den
Cursor zurück. Trifft der Klick eine Überschrift aus einer eingebundenen Datei,
wird diese Datei in einem neuen Tab geöffnet.

Ein Klick in die Gliederung bewegt beides: der Editor springt zur Überschrift,
die Vorschau zieht nach. Die Gliederung zeigt die Überschriften der gerade
offenen Datei und wächst beim Tippen mit.

## Tabs, die die Vorschau nicht übernehmen

Bilder werden angezeigt statt als Text geöffnet, und Vorlagen ergeben für sich
gerendert nichts Sinnvolles. Beide lassen die Vorschau deshalb auf dem zuletzt
gerenderten Dokument stehen; ihre Tabs sind kursiv gesetzt.

Als Vorlage gilt, was in einem Ordner `template`/`templates` liegt oder
"template" im Namen trägt. Liegt die Erkennung daneben, schaltet der Knopf
**Vorschau: an/aus** in der Fußzeile den aktiven Tab um.

## Welche Dateien behandelt werden

Bewusst als Positivliste in `src/state.ts`: nur bekannte Endungen werden
angefasst, alles andere bleibt zu. So kann ein neuer Dateityp nichts kaputt
machen, statt versuchsweise als Text geladen oder gesetzt zu werden.

| | |
|---|---|
| gesetzt (Vorschau) | nur `.typ` |
| im Editor bearbeitbar | `.typ .bib .yaml .yml .toml .json .csv .txt .md .cls .sty .csl` |
| als Bild angezeigt | `.png .jpg .jpeg .gif .webp .svg .avif .bmp` |
| alles übrige | wird nicht geöffnet |

Eine Literaturdatei übernimmt also nicht die Vorschau — sie ergäbe für sich
gesetzt kein Dokument.

## Schreiben

Klammern und Anführungszeichen schließen sich selbst; steht Text in der
Auswahl, wird er umschlossen statt ersetzt. Enter vor einer schließenden
Klammer spreizt sie auf eine eigene Zeile auf:

```
@article{meier2024,     @article{meier2024,
                   |  →    |
                        }
```

Literaturdateien werden wie Quelltext behandelt: eigene Einfärbung für
Eintragsarten, Zitierschlüssel und Felder, dazu Einrückung. Der Modus dafür
steht in `src/bibtex.ts` — für BibLaTeX gibt es kein brauchbares fertiges
CodeMirror-Paket, die Sprache ist aber klein genug.

## Neue Dateien und Bilder

**Neu** in der Seitenleiste (oder Strg+N) legt eine Datei im Wurzelordner an
und öffnet sie. Ohne Endung wird `.typ` angenommen; `quellen.bib` entsteht,
indem man die Endung mitschreibt oder den Befehl *Neue Literaturdatei* nimmt.
Ein bereits vorhandener Name wird abgelehnt statt überschrieben.

**Bild** übernimmt Bilddateien von der Platte in den Ordner `assets/` neben dem
Dokument und fügt die `#image(…)`-Verweise an der Cursorstelle ein. Gleichnamige
Dateien werden durchnummeriert, nie überschrieben. Für Bilder aus der
Zwischenablage genügt weiterhin Strg+V.

## Automatische Sicherungen

Alle zehn Minuten wird von jeder offenen Datei ein Stand abgelegt — gesichert
wird der Puffer, also auch das noch nicht Gespeicherte. Fünf Stände bleiben
erhalten, der älteste fällt heraus. Dateien über 10 MB und unverändertes
werden übersprungen, damit keine identischen Fassungen die echten verdrängen.

Die Stände liegen unter `%LOCALAPPDATA%\com.loris.tau\versionen\<datei>\` mit
dem Zeitstempel als Namen. Der Knopf **Versionen** in der Fußzeile öffnet den
Ordner der aktuellen Datei.

Der zuletzt geöffnete Ordner kommt beim nächsten Start von selbst wieder.
Zeilenenden bleiben erhalten: eine Datei mit CRLF wird auch wieder mit CRLF
geschrieben.

## Aufbau

```
src/
  main.ts      Verdrahtung, Tastenkürzel, Darstellung
  preview.ts   tinymist starten, Ports lesen, WebSocket-Protokoll
  editor.ts    CodeMirror, Bild-Einfügen, Sprungmarken
  tree.ts      Dateibaum und Schnellsuche
  lib.ts       reine Hilfsfunktionen (geprüft in lib.test.ts)
  state.ts     offene Tabs
```

`bun test` prüft die Parsing-Logik: das Auslesen der tinymist-Adressen, den
Pfadvergleich und das Wiederfinden von Überschriften im Quelltext.

## Programmsymbol ändern

Quelle ist `assets/logo.png` (mindestens 1024×1024, mit Alphakanal):

```bash
bun run tauri icon assets/logo.png
```

Danach `src-tauri/build.rs` anfassen (`touch`) und neu bauen — sonst bleibt das
alte Symbol in der EXE stehen: das Einbetten passiert im Build-Schritt, und der
läuft nicht neu, bloß weil sich Bilddateien geändert haben.

## tinymist aktualisieren

Die Version muss zur benutzten Typst-Fassung passen (derzeit tinymist 0.15.8 für
Typst 0.15.x). Zum Aktualisieren die Binary aus dem
[Release](https://github.com/Myriad-Dreamin/tinymist/releases) laden und als
`src-tauri/bin/tinymist-x86_64-pc-windows-msvc.exe` ablegen — der Namenszusatz
ist die Zielplattform und von Tauri so verlangt.
