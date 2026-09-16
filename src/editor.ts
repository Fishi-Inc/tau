import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  type Command,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  syntaxHighlighting,
  indentOnInput,
  indentUnit,
  bracketMatching,
} from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { bibtex } from "./bibtex";
// Der `/lezer`-Einstieg ist die Fassung in reinem JavaScript. Der Hauptexport
// bindet stattdessen Typsts echten Parser als WASM ein — der braucht zusätzlich
// einen eigenen View-Plugin und übersteht Vites Vorbündelung nicht.
import {
  typst_lezer,
  TypstHighlightSytle,
  typstCompletionSource,
  typstLezerFoldService,
  typstLezerIndentService,
  typstLezerListKeymap,
} from "codemirror-lang-typst/lezer";

export type EditorHooks = {
  onChange: (content: string) => void;
  onCursor: (line: number, character: number) => void;
  onSave: () => void;
  onPasteImage: (file: File) => Promise<string | null>; // gibt den einzufügenden Text zurück
  onQuickOpen: () => void;
};

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "14px" },
  ".cm-scroller": {
    fontFamily: "'Cascadia Code', Consolas, 'SF Mono', monospace",
    lineHeight: "1.65",
    padding: "24px 0 50vh 0", // unten Luft, damit die letzte Zeile mittig stehen kann
  },
  ".cm-content": { maxWidth: "780px", margin: "0 auto", padding: "0 28px" },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-cursor": { borderLeftWidth: "2px", borderLeftColor: "var(--fg)" },
});

let suppressCursor = false;

/** Fach für die Sprache, damit sie beim Wechsel der Datei getauscht werden kann. */
const sprachFach = new Compartment();

const typstUmgebung = [
  typst_lezer(),
  syntaxHighlighting(TypstHighlightSytle),
  typstLezerFoldService,
  typstLezerIndentService,
  typstLezerListKeymap, // setzt Aufzählungen beim Zeilenumbruch fort
  autocompletion({ override: [typstCompletionSource] }),
];

// BibLaTeX wird wie Quelltext behandelt: eigene Einfärbung und Einrückung.
const bibUmgebung = [bibtex, syntaxHighlighting(TypstHighlightSytle)];

/** Passende Sprachumgebung zur Datei — alles Unbekannte bleibt ohne. */
const umgebungFuer = (pfad: string) =>
  /\.typ$/i.test(pfad) ? typstUmgebung : /\.bib$/i.test(pfad) ? bibUmgebung : [];

/**
 * Enter vor einer schließenden Klammer spreizt sie auf eine eigene Zeile auf:
 *
 *     @article{meier,|}        @article{meier,
 *                        -->     |
 *                              }
 *
 * Geprüft wird nur, was hinter dem Cursor steht — beim Tippen steht davor
 * meist schon Inhalt (`meier,`) und nicht mehr die öffnende Klammer. Ohne das
 * rutscht die schließende Klammer bloß mit und der Rumpf entsteht daneben
 * statt darin.
 */
const klammerAufspreizen: Command = (view) => {
  const { state } = view;
  const bereich = state.selection.main;
  if (!bereich.empty) return false;
  const danach = state.doc.sliceString(bereich.head, bereich.head + 1);
  if (!/[}\])]/.test(danach)) return false;

  const einzug = /^[ \t]*/.exec(state.doc.lineAt(bereich.head).text)![0];
  const insert = `\n${einzug}  \n${einzug}`;
  view.dispatch({
    changes: { from: bereich.head, insert },
    // Cursor auf die mittlere, eingerückte Zeile
    selection: { anchor: bereich.head + 1 + einzug.length + 2 },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
};

export function createEditor(parent: HTMLElement, hooks: EditorHooks): EditorView {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        // Die Sprache hängt an der geöffneten Datei und wird beim Tabwechsel
        // ausgetauscht — deshalb in einem eigenen Fach.
        sprachFach.of(typstUmgebung),
        // Klammern und Anführungszeichen schließen sich selbst; die Auswahl
        // umschließen sie, statt sie zu ersetzen.
        closeBrackets(),
        bracketMatching(),
        indentOnInput(),
        indentUnit.of("  "),
        theme,
        keymap.of([
          ...closeBracketsKeymap,
          { key: "Enter", run: klammerAufspreizen },
          {
            key: "Mod-s",
            run: () => {
              hooks.onSave();
              return true;
            },
          },
          {
            key: "Mod-p",
            run: () => {
              hooks.onQuickOpen();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.domEventHandlers({
          paste: (event, v) => {
            const file = [...(event.clipboardData?.files ?? [])].find((f) =>
              f.type.startsWith("image/"),
            );
            if (!file) return false;
            event.preventDefault();
            // Schreiben ist asynchron; eingefügt wird, sobald die Datei liegt.
            hooks.onPasteImage(file).then((snippet) => {
              if (!snippet) return;
              const at = v.state.selection.main;
              v.dispatch({
                changes: { from: at.from, to: at.to, insert: snippet },
                selection: { anchor: at.from + snippet.length },
              });
            });
            return true;
          },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) hooks.onChange(u.state.doc.toString());
          if ((u.selectionSet || u.docChanged) && !suppressCursor) {
            const pos = u.state.selection.main.head;
            const line = u.state.doc.lineAt(pos);
            hooks.onCursor(line.number - 1, pos - line.from);
          }
        }),
      ],
    }),
  });
  return view;
}

/** Inhalt eines anderen Tabs laden, ohne die Vorschau als Cursor-Bewegung zu irritieren. */
export function setContent(view: EditorView, content: string, pfad = "") {
  suppressCursor = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    selection: { anchor: 0 },
    scrollIntoView: true,
    effects: sprachFach.reconfigure(umgebungFuer(pfad)),
  });
  suppressCursor = false;
}

/** Sprung aus der Gliederung: Zeile anspringen und in den Blick rücken. */
export function scrollToLine(view: EditorView, line: number) {
  const pos = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 60 }),
  });
  view.focus();
}

/** Sprung aus der Vorschau in die Quelle. Löst bewusst kein panelScrollTo aus. */
export function jumpTo(view: EditorView, line: number, character: number) {
  const l = Math.min(line + 1, view.state.doc.lines);
  const target = Math.min(view.state.doc.line(l).from + character, view.state.doc.line(l).to);
  suppressCursor = true;
  view.dispatch({
    selection: { anchor: target },
    effects: EditorView.scrollIntoView(target, { y: "center" }),
  });
  view.focus();
  // Erst nach dem Ereignis-Durchlauf wieder freigeben, sonst meldet der
  // updateListener den gerade gesetzten Cursor zurück an die Vorschau.
  setTimeout(() => (suppressCursor = false), 0);
}

