import { expect, test } from "bun:test";
import { StringStream } from "@codemirror/language";
import { bibToken, bibEinrueckung, type BibZustand } from "./bibtex";

/** Zerlegt eine Zeile in [Textstück, Art] — so wie der Editor es täte. */
function zerlege(zeile: string, state: BibZustand = { tiefe: 0 }) {
  const stream = new StringStream(zeile, 2, 2, 0);
  const out: [string, string | null][] = [];
  while (!stream.eol()) {
    const art = bibToken(stream, state);
    const text = stream.current();
    stream.start = stream.pos;
    // Leerraum liefert der Zerleger als eigenes Stück ohne Art — hier nicht von Belang.
    if (text && art !== null) out.push([text, art]);
  }
  return out;
}

test("bibToken erkennt Eintragsart, Schlüssel und Felder", () => {
  const state: BibZustand = { tiefe: 0 };
  expect(zerlege("@article{meier2024,", state)).toEqual([
    ["@article", "keyword"],
    ["{", "bracket"],
    ["meier2024", "variableName"],
    [",", "punctuation"],
  ]);
  // innerhalb des Eintrags: Feldname vor dem Gleichheitszeichen
  expect(zerlege("  author = {Meier, Anna},", state)).toEqual([
    ["author", "propertyName"],
    ["=", "punctuation"],
    ["{", "bracket"],
    ["Meier", "variableName"],
    [",", "punctuation"],
    ["Anna", "variableName"],
    ["}", "bracket"],
    [",", "punctuation"],
  ]);
  expect(zerlege("  year = 2024,", state)).toEqual([
    ["year", "propertyName"],
    ["=", "punctuation"],
    ["2024", "number"],
    [",", "punctuation"],
  ]);
  // Zeichenketten in Anführungszeichen sind ebenfalls gültig
  expect(zerlege('  journal = "Zeitschrift",', state)).toEqual([
    ["journal", "propertyName"],
    ["=", "punctuation"],
    ['"Zeitschrift"', "string"],
    [",", "punctuation"],
  ]);
  // schließende Klammer beendet den Eintrag
  expect(zerlege("}", state)).toEqual([["}", "bracket"]]);
  expect(state.tiefe).toBe(0);
});

test("Text außerhalb eines Eintrags gilt als Kommentar", () => {
  expect(zerlege("% eine Notiz")).toEqual([["% eine Notiz", "comment"]]);
  expect(zerlege("einfach Text")).toEqual([["einfach Text", "comment"]]);
});

test("bibEinrueckung zieht die schließende Klammer nach außen", () => {
  expect(bibEinrueckung(1, "  author = {…}", 2)).toBe(2);
  expect(bibEinrueckung(1, "}", 2)).toBe(0);
  expect(bibEinrueckung(2, "}", 2)).toBe(2);
  expect(bibEinrueckung(0, "@article{x,", 2)).toBe(0);
  // nie negativ, auch wenn eine Klammer zu viel geschlossen wurde
  expect(bibEinrueckung(0, "}", 2)).toBe(0);
});
