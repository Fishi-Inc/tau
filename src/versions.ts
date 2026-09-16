// Automatische Sicherungen: alle zehn Minuten eine Fassung je offener Datei,
// fünf Stände werden behalten. Gesichert wird der Puffer, nicht die Platte —
// gerade die ungespeicherten Änderungen sind ja die, die verloren gehen können.
//
// Die Stände liegen beim Dokument selbst, in einem versteckten Ordner `.v`
// des jeweiligen Projektordners, und heißen "Version 1", "Version 2" … —
// so ist ohne Erklärung klar, was man vor sich hat.
import { invoke } from "@tauri-apps/api/core";
import { mkdir, writeTextFile, readDir, remove } from "@tauri-apps/plugin-fs";
import { basename, dirname } from "./state";

export const ABSTAND_MS = 10 * 60 * 1000;
export const ANZAHL_STAENDE = 5;
export const GROESSENGRENZE = 10 * 1024 * 1024; // 10 MB

/** Trennzeichen des Pfades beibehalten, damit Pfade nativ bleiben. */
const sep = (p: string) => (p.includes("\\") ? "\\" : "/");

/** Nummer aus "Version 3.typ" — null, wenn der Name keine Sicherung ist. */
export function nummer(name: string): number | null {
  const m = name.match(/^Version (\d+)\./);
  return m ? Number(m[1]) : null;
}

/**
 * Welche Stände müssen weg, damit höchstens `max` übrig bleiben?
 * Die kleinste Nummer ist die älteste. Verglichen wird als Zahl, sonst käme
 * "Version 10" vor "Version 9".
 */
export function veraltete(dateien: string[], max = ANZAHL_STAENDE): string[] {
  const staende = dateien
    .map((name) => ({ name, v: nummer(name) }))
    .filter((s): s is { name: string; v: number } => s.v !== null)
    .sort((a, b) => a.v - b.v);
  return staende.slice(0, Math.max(0, staende.length - max)).map((s) => s.name);
}

/** Die Zählung läuft weiter, auch wenn die alten Stände weggeräumt sind. */
export function naechsteNummer(dateien: string[]): number {
  return Math.max(0, ...dateien.map((n) => nummer(n) ?? 0)) + 1;
}

/** Der versteckte Sicherungsordner eines Projektordners. */
export const wurzel = (ordner: string) => `${ordner}${sep(ordner)}.v`;

/** Ordner, in dem die Stände einer bestimmten Datei liegen. */
export const ordnerFuer = (pfad: string) =>
  `${wurzel(dirname(pfad))}${sep(pfad)}${basename(pfad)}`;

/**
 * Einen Stand ablegen und die ältesten wegräumen.
 * Gibt zurück, ob gesichert wurde.
 */
export async function sichereStand(pfad: string, inhalt: string): Promise<boolean> {
  if (new TextEncoder().encode(inhalt).length > GROESSENGRENZE) return false;

  const ordner = ordnerFuer(pfad);
  const s = sep(pfad);
  await mkdir(ordner, { recursive: true });
  // Ein führender Punkt versteckt unter Windows nichts, das macht erst das
  // Dateiattribut. Schlägt es fehl, ist das kein Grund, nicht zu sichern.
  await invoke("verstecken", { pfad: wurzel(dirname(pfad)) }).catch(() => {});

  const vorhanden = (await readDir(ordner)).filter((e) => e.isFile).map((e) => e.name);
  const endung = pfad.match(/\.[^.\\/]+$/)?.[0] ?? ".txt";
  const neu = `Version ${naechsteNummer(vorhanden)}${endung}`;
  await writeTextFile(`${ordner}${s}${neu}`, inhalt);

  for (const alt of veraltete([...vorhanden, neu])) {
    await remove(`${ordner}${s}${alt}`).catch(() => {});
  }
  return true;
}

/**
 * Sichert alle übergebenen Dateien, überspringt aber, was sich seit dem letzten
 * Stand nicht geändert hat — sonst stünden nach einer Stunde Pause fünf
 * identische Fassungen da und die echten Stände wären herausgefallen.
 */
const zuletztGesichert = new Map<string, string>();

export async function sichereAlle(
  dateien: { path: string; content: string; bild: boolean }[],
): Promise<number> {
  let gesichert = 0;
  for (const d of dateien) {
    if (d.bild || zuletztGesichert.get(d.path) === d.content) continue;
    if (await sichereStand(d.path, d.content)) {
      zuletztGesichert.set(d.path, d.content);
      gesichert++;
    }
  }
  return gesichert;
}
