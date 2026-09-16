export type Tab = {
  path: string;
  name: string;
  content: string; // aktueller Pufferinhalt (bei Bildern leer)
  saved: string; // Inhalt, wie er auf der Platte liegt
  eol: "\n" | "\r\n"; // Zeilenende der Datei, wird beim Speichern beibehalten
  bild: boolean; // Bilder werden angezeigt, nicht als Text bearbeitet
  rendern: boolean; // ob dieser Tab die Vorschau übernimmt
};

// Positivlisten: behandelt wird nur, was sicher funktioniert. Eine unbekannte
// Endung wird gar nicht erst geöffnet, statt sie versuchsweise als Text zu
// laden oder setzen zu lassen — so kann kein neuer Dateityp etwas kaputt machen.

export const istBild = (p: string) => /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(p);

/** Nur Typst-Dateien ergeben ein Dokument — Literatur, Daten und Ähnliches nicht. */
export const istTypst = (p: string) => /\.typ$/i.test(p);

/** Endungen, die gefahrlos im Editor bearbeitet werden können. */
export const istText = (p: string) =>
  /\.(typ|bib|ya?ml|toml|json|csv|txt|md|cls|sty|csl)$/i.test(p);

/**
 * Vorlagen liegen in einem Ordner `template(s)` oder tragen "template" im
 * Namen. Sie ergeben für sich gerendert nichts Sinnvolles, deshalb behält die
 * Vorschau beim Öffnen das zuletzt gerenderte Dokument.
 */
export const istTemplate = (p: string) =>
  /(^|[\\/])templates?[\\/]/i.test(p) || /template[^\\/]*$/i.test(p);

export type State = {
  root: string | null;
  tabs: Tab[];
  active: number;
};

export const state: State = { root: null, tabs: [], active: -1 };

export const activeTab = (): Tab | null => state.tabs[state.active] ?? null;
export const isDirty = (t: Tab) => t.content !== t.saved;

export const findTab = (path: string) => state.tabs.findIndex((t) => t.path === path);

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirname = (p: string) => p.slice(0, p.length - basename(p).length - 1);
