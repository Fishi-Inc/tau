// Reine Hilfsfunktionen — ohne DOM, ohne Tauri, damit sie prüfbar bleiben.

/**
 * Zieht die Adressen aus den Startmeldungen von tinymist. Ältere Fassungen
 * schreiben "Control panel", neuere "Control plane".
 */
export function parseHost(line: string): { kind: "data" | "control"; host: string } | null {
  const data = line.match(/Data plane server listening on:\s*(\S+)/);
  if (data) return { kind: "data", host: data[1] };
  const control = line.match(/Control (?:panel|plane) server listening on:\s*(\S+)/);
  if (control) return { kind: "control", host: control[1] };
  return null;
}

/** Pfade vergleichen: tinymist meldet sie in der Schreibweise des Systems zurück. */
export const samePath = (a: string, b: string) =>
  a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

/**
 * Prüft einen eingegebenen Dateinamen und ergänzt die Endung.
 *
 * Ohne Endung wird `.typ` angenommen; `.bib` und die übrigen Textendungen
 * bleiben stehen. Pfadtrenner und die unter Windows verbotenen Zeichen werden
 * abgewiesen, statt sie stillschweigend zu ersetzen — sonst entstünde eine
 * Datei an einer anderen Stelle als der Eingabe.
 */
export function pruefeDateiname(
  eingabe: string,
  standardEndung = ".typ",
): { name: string } | { fehler: string } {
  const name = eingabe.trim();
  if (!name) return { fehler: "kein Name angegeben" };
  if (/[\\/]/.test(name)) return { fehler: "Unterordner sind hier nicht möglich" };
  if (/[:*?"<>|]/.test(name)) return { fehler: 'unzulässiges Zeichen (: * ? " < > |)' };
  if (/^\.+$/.test(name)) return { fehler: "kein Name angegeben" };
  return { name: /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}${standardEndung}` };
}

export type Heading = { level: number; title: string; line: number };

/**
 * Überschriften des offenen Textes, für die Gliederung in der Seitenleiste.
 * Bewusst aus dem Puffer statt aus der Gliederung des Servers: so gehört sie
 * immer zur gerade offenen Datei, steht sofort beim Tippen und hängt an keinem
 * Server-Zustand.
 * ponytail: erkennt die Überschriften der Auszeichnungssprache. Titel, die
 * erst aus Code entstehen (`#heading[…]`), fehlen — die liefert nur der Server.
 */
export function parseOutline(text: string): Heading[] {
  const out: Heading[] = [];
  text.split("\n").forEach((zeile, i) => {
    const m = zeile.match(/^(=+)[ \t]+(.*\S)[ \t]*$/);
    if (m) out.push({ level: m[1].length, title: m[2], line: i });
  });
  return out;
}

/**
 * Spalte, auf die die Vorschau tatsächlich springt.
 *
 * tinymist findet nur etwas, wenn die Spalte *innerhalb* eines gesetzten
 * Textstücks liegt — auf dessen erstem Zeichen bleibt die Vorschau stumm
 * stehen. Gemessen mit tinymist 0.15.8: `= Zwei` springt erst ab Spalte 3,
 * `== Zweiter Abschnitt` erst ab 4, ein gewöhnliches `Text a` erst ab 1.
 * Also hinter den Marker der Zeile und von dort eine Stelle weiter, höchstens
 * bis zum Zeilenende.
 */
export function zielSpalte(zeile: string, spalte: number): number {
  const marker = zeile.match(/^[ \t]*(?:=+|[-+]|\/|\d+\.)?[ \t]*/)![0].length;
  return Math.min(Math.max(spalte, marker) + 1, zeile.length);
}
