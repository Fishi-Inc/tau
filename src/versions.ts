// Automatische Sicherungen: alle zehn Minuten eine Fassung je offener Datei,
// fünf Stände werden behalten. Gesichert wird der Puffer, nicht die Platte —
// gerade die ungespeicherten Änderungen sind ja die, die verloren gehen können.
import { appLocalDataDir } from "@tauri-apps/api/path";
import { mkdir, writeTextFile, readDir, remove } from "@tauri-apps/plugin-fs";

export const ABSTAND_MS = 10 * 60 * 1000;
export const ANZAHL_STAENDE = 5;
export const GROESSENGRENZE = 10 * 1024 * 1024; // 10 MB

/** Voller Pfad → ein Ordnername, der auf jedem Dateisystem zulässig ist. */
export function ordnerName(pfad: string): string {
  return pfad.replace(/[\\/:*?"<>|]/g, "-").replace(/^-+/, "");
}

/** Sortierbarer Zeitstempel: 2026-09-15_14-30-00 */
export function zeitstempel(d = new Date()): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}` +
    `_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`
  );
}

/**
 * Welche Stände müssen weg, damit höchstens `max` übrig bleiben?
 * Die Namen beginnen mit dem Zeitstempel, alphabetisch sortiert ist also
 * zugleich chronologisch — die ältesten stehen vorn.
 */
export function veraltete(dateien: string[], max = ANZAHL_STAENDE): string[] {
  const sortiert = [...dateien].sort();
  return sortiert.slice(0, Math.max(0, sortiert.length - max));
}

/** Basisordner aller Sicherungen. */
export const wurzel = async () => `${await appLocalDataDir()}/versionen`;

/** Ordner, in dem die Stände einer bestimmten Datei liegen. */
export const ordnerFuer = async (pfad: string) => `${await wurzel()}/${ordnerName(pfad)}`;

/**
 * Einen Stand ablegen und die ältesten wegräumen.
 * Gibt zurück, ob gesichert wurde.
 */
export async function sichereStand(pfad: string, inhalt: string): Promise<boolean> {
  if (new TextEncoder().encode(inhalt).length > GROESSENGRENZE) return false;

  const ordner = await ordnerFuer(pfad);
  await mkdir(ordner, { recursive: true });

  const endung = pfad.match(/\.[^.\\/]+$/)?.[0] ?? ".txt";
  await writeTextFile(`${ordner}/${zeitstempel()}${endung}`, inhalt);

  const vorhanden = (await readDir(ordner)).filter((e) => e.isFile).map((e) => e.name);
  for (const alt of veraltete(vorhanden)) {
    await remove(`${ordner}/${alt}`).catch(() => {});
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
