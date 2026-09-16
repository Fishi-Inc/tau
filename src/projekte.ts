// Zuletzt geöffnete Projekte. Ein Projekt ist schlicht der Ordner, in dem das
// Dokument liegt: geöffnet wird der Ordner, gespeichert wird darin. Gemerkt
// wird nur die Liste der Pfade — alles Weitere steht ohnehin auf der Platte.
const SCHLUESSEL = "tau.projekte";
export const HOECHSTZAHL = 10;

/**
 * Pfad nach vorn, Doppelte raus, Liste gekappt. Rein rechnend gehalten, damit
 * sich die Reihenfolge ohne Browser prüfen lässt.
 */
export function einreihen(liste: string[], pfad: string, max = HOECHSTZAHL): string[] {
  return [pfad, ...liste.filter((p) => p !== pfad)].slice(0, max);
}

export function letzteProjekte(): string[] {
  try {
    const roh: unknown = JSON.parse(localStorage.getItem(SCHLUESSEL) ?? "[]");
    return Array.isArray(roh) ? roh.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return []; // beschädigter Eintrag: lieber ohne Verlauf starten als gar nicht
  }
}

const schreibe = (liste: string[]) => localStorage.setItem(SCHLUESSEL, JSON.stringify(liste));

export const merke = (pfad: string) => schreibe(einreihen(letzteProjekte(), pfad));

/** Nach einem Projekt, das es nicht mehr gibt. */
export const vergiss = (pfad: string) => schreibe(letzteProjekte().filter((p) => p !== pfad));
