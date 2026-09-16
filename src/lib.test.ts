import { expect, test } from "bun:test";
import { parseHost, samePath, parseOutline, pruefeDateiname, zielSpalte } from "./lib";

test("parseHost liest die Adressen aus den Startmeldungen", () => {
  const data =
    "[2026-09-11T23:05:27Z INFO  tinymist::compat::preview] Data plane server listening on: 127.0.0.1:43616";
  const control =
    "[2026-09-11T23:05:27Z INFO  tinymist::compat::preview] Control panel server listening on: 127.0.0.1:43615";

  expect(parseHost(data)).toEqual({ kind: "data", host: "127.0.0.1:43616" });
  expect(parseHost(control)).toEqual({ kind: "control", host: "127.0.0.1:43615" });
  // Neuere Fassungen schreiben "plane" statt "panel"
  expect(parseHost("Control plane server listening on: 127.0.0.1:1")).toEqual({
    kind: "control",
    host: "127.0.0.1:1",
  });
  // Der Static-File-Server teilt sich den Port mit dem Data Plane und darf
  // nicht als eigene Adresse durchgehen.
  expect(parseHost("Static file server listening on: 127.0.0.1:43616")).toBeNull();
  expect(parseHost("irgendeine andere Zeile")).toBeNull();
});

test("samePath ignoriert Trennzeichen und Groß-/Kleinschreibung", () => {
  expect(samePath("D:\\Code\\tau\\main.typ", "d:/code/tau/main.typ")).toBe(true);
  expect(samePath("/home/x/a.typ", "/home/x/a.typ")).toBe(true);
  expect(samePath("D:\\a\\b.typ", "D:\\a\\c.typ")).toBe(false);
});

test("parseOutline findet Überschriften mit Ebene und Zeile", () => {
  const doc = [
    "#set page(margin: 2cm)", // 0
    "", // 1
    "= Titel", // 2
    "", // 3
    "Text mit = einem Gleichheitszeichen mittendrin.", // 4
    "== Unterkapitel", // 5
    "=== Noch tiefer", // 6
    "=kein Titel", // 7  (ohne Leerzeichen: keine Überschrift)
    "=   ", // 8  (ohne Text: keine Überschrift)
    "== Mit Leerraum hinten   ", // 9
  ].join("\n");

  expect(parseOutline(doc)).toEqual([
    { level: 1, title: "Titel", line: 2 },
    { level: 2, title: "Unterkapitel", line: 5 },
    { level: 3, title: "Noch tiefer", line: 6 },
    { level: 2, title: "Mit Leerraum hinten", line: 9 },
  ]);

  expect(parseOutline("")).toEqual([]);
});

test("pruefeDateiname ergänzt die Endung und weist Unsinn ab", () => {
  expect(pruefeDateiname("kapitel")).toEqual({ name: "kapitel.typ" });
  expect(pruefeDateiname("  kapitel  ")).toEqual({ name: "kapitel.typ" });
  // vorhandene Endungen bleiben stehen
  expect(pruefeDateiname("quellen.bib")).toEqual({ name: "quellen.bib" });
  expect(pruefeDateiname("daten.yaml")).toEqual({ name: "daten.yaml" });
  // Punkte im Namen sind erlaubt, solange eine Endung folgt
  expect(pruefeDateiname("kapitel.1.typ")).toEqual({ name: "kapitel.1.typ" });

  // abgewiesen wird, was den Pfad verlassen oder das Dateisystem stören würde
  expect(pruefeDateiname("")).toHaveProperty("fehler");
  expect(pruefeDateiname("   ")).toHaveProperty("fehler");
  expect(pruefeDateiname("unter/ordner.typ")).toHaveProperty("fehler");
  expect(pruefeDateiname("..\\raus.typ")).toHaveProperty("fehler");
  expect(pruefeDateiname("frage?.typ")).toHaveProperty("fehler");
  expect(pruefeDateiname("..")).toHaveProperty("fehler");
});

test("pruefeDateiname nimmt eine vorgegebene Endung", () => {
  expect(pruefeDateiname("quellen", ".bib")).toEqual({ name: "quellen.bib" });
  // eine getippte Endung sticht die Vorgabe
  expect(pruefeDateiname("quellen.typ", ".bib")).toEqual({ name: "quellen.typ" });
});

test("zielSpalte zielt hinter den Marker der Zeile", () => {
  // Überschriften: die Vorschau springt erst hinter den "="-Marker.
  expect(zielSpalte("= Zwei", 0)).toBe(3);
  expect(zielSpalte("= Zwei", 2)).toBe(3);
  expect(zielSpalte("== Zweiter Abschnitt", 0)).toBe(4);
  // Weiter hinten im Text bleibt die Stelle erhalten (eine Spalte weiter).
  expect(zielSpalte("= Zwei", 4)).toBe(5);
  // Am Zeilenende nicht darüber hinaus.
  expect(zielSpalte("= Zwei", 6)).toBe(6);
  // Gewöhnlicher Text: Spalte 0 trifft noch nichts.
  expect(zielSpalte("Text a", 0)).toBe(1);
  expect(zielSpalte("  eingerückt", 0)).toBe(3);
  expect(zielSpalte("- Listenpunkt", 0)).toBe(3);
  expect(zielSpalte("", 0)).toBe(0);
});
