// BibLaTeX für CodeMirror. Es gibt dafür kein brauchbares fertiges Paket
// (`codemirror-lang-bibtex` ist ein leerer Registry-Eintrag), die Sprache ist
// aber klein genug: Einträge, Felder, geschweifte Gruppen, Zeichenketten.
import { StreamLanguage, type StringStream } from "@codemirror/language";

export type BibZustand = { tiefe: number };

/** Einzelner Schritt des Zerlegers — getrennt, damit er prüfbar bleibt. */
export function bibToken(stream: StringStream, state: BibZustand): string | null {
  if (stream.eatSpace()) return null;

  // Außerhalb eines Eintrags ist alles Beiwerk; BibTeX behandelt es als Kommentar.
  if (state.tiefe === 0) {
    if (stream.peek() === "@") {
      stream.next();
      stream.eatWhile(/[A-Za-z]/); // @article, @book, @inproceedings …
      return "keyword";
    }
    if (stream.peek() === "{") {
      stream.next();
      state.tiefe = 1;
      return "bracket";
    }
    stream.skipToEnd();
    return "comment";
  }

  const ch = stream.next();
  if (ch === "{") {
    state.tiefe++;
    return "bracket";
  }
  if (ch === "}") {
    state.tiefe--;
    return "bracket";
  }
  if (ch === '"') {
    while (!stream.eol()) if (stream.next() === '"') break;
    return "string";
  }
  if (ch === "=" || ch === ",") return "punctuation";
  if (ch && /[0-9]/.test(ch)) {
    stream.eatWhile(/[0-9]/);
    return "number";
  }
  if (ch && /[A-Za-z_]/.test(ch)) {
    stream.eatWhile(/[A-Za-z0-9_:.\-]/);
    // Ein Wort, auf das ein "=" folgt, ist ein Feldname; sonst der Zitierschlüssel
    // beziehungsweise ein Wert ohne Klammern.
    return stream.match(/^\s*=/, false) ? "propertyName" : "variableName";
  }
  return null;
}

/**
 * Einrücktiefe für die nächste Zeile. Eine Zeile, die mit `}` beginnt, gehört
 * eine Ebene nach außen — sonst stünde die schließende Klammer eingerückt.
 */
export function bibEinrueckung(tiefe: number, folgetext: string, einheit: number): number {
  const schliesst = /^\s*\}/.test(folgetext);
  return Math.max(0, tiefe - (schliesst ? 1 : 0)) * einheit;
}

export const bibtex = StreamLanguage.define<BibZustand>({
  name: "bibtex",
  startState: () => ({ tiefe: 0 }),
  copyState: (s) => ({ tiefe: s.tiefe }),
  token: bibToken,
  indent: (state, textAfter, cx) => bibEinrueckung(state.tiefe, textAfter, cx.unit),
  languageData: {
    commentTokens: { line: "%" },
    closeBrackets: { brackets: ["{", "[", "(", '"'] },
    indentOnInput: /^\s*\}$/,
  },
});
