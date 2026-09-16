// Anbindung an `tinymist preview`. Der Prozess liefert das gerenderte Dokument
// (als eigenes Web-Frontend, das wir in ein <iframe> hängen) und spricht daneben
// ein kleines WebSocket-Protokoll, über das Editor und Vorschau synchron bleiben.
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { parseHost } from "./lib";

export type PreviewHandlers = {
  onReady: (frameUrl: string) => void;
  onEditorScrollTo: (filepath: string, line: number, character: number) => void;
  onStatus: (kind: string) => void;
  onSyncRequest: () => void;
  onExit: (msg: string) => void;
};

let child: Child | null = null;
let ctrl: WebSocket | null = null;
let currentFile: string | null = null;
/**
 * Zählt die Starts. Ein beendeter Vorgänger liefert seine gepufferte Ausgabe
 * noch nach; ohne diesen Vergleich würde sein Handler die Verbindung zu seiner
 * eigenen — inzwischen toten — Adresse aufbauen und damit den Platz belegen,
 * den der neue Prozess braucht.
 */
let startZaehler = 0;

/** Läuft die Vorschau bereits für genau diese Datei? */
export const previewMatches = (file: string) => currentFile === file && !!ctrl;

export async function stopPreview() {
  ctrl?.close();
  ctrl = null;
  try {
    await child?.kill();
  } catch (e) {
    console.warn("tinymist ließ sich nicht beenden:", e);
  }
  child = null;
  currentFile = null;
}

/**
 * Startet die Vorschau für `file`. tinymist bindet sich an genau ein Dokument,
 * deshalb wird beim Wechsel des Tabs neu gestartet (dauert unter einer Sekunde).
 *
 * Aufrufe dürfen sich nicht überlappen — sonst beendet der eine den Prozess des
 * anderen und es bleiben Waisen liegen. Dafür sorgt die Warteschlange in
 * `syncPreview` (main.ts); hier wird davon ausgegangen, dass jeweils nur ein
 * Start gleichzeitig läuft.
 *
 * ponytail: Neustart pro Dokument. Wenn das beim Springen zwischen vielen Tabs
 * stört, wäre der Upgrade-Pfad ein angepinntes Hauptdokument, das stehen bleibt.
 */
export async function startPreview(root: string, file: string, h: PreviewHandlers) {
  // Zuerst zählen, dann warten: während `stopPreview` läuft, liefert der alte
  // Prozess noch Ausgabe nach. Stünde die Zählung danach, sähe sein Handler
  // sich noch als aktuell und würde die Verbindung zu seiner eigenen, gleich
  // toten Adresse aufbauen — der neue Prozess fände den Platz besetzt vor.
  const meinStart = ++startZaehler;
  await stopPreview();
  currentFile = file;

  // Der Aufruf gilt erst als erledigt, wenn die Verbindung steht — nicht schon,
  // wenn der Prozess gestartet ist. Sonst sieht der nächste Aufruf in der
  // Warteschlange eine noch unverbundene Vorschau, startet neu und beendet
  // dabei den gerade hochfahrenden Prozess: die Anzeige bliebe auf "startet…".
  let verbunden!: () => void;
  const stehtBereit = new Promise<void>((r) => (verbunden = r));

  const cmd = Command.sidecar("bin/tinymist", [
    "preview",
    "--no-open",
    "--partial-rendering",
    "true",
    "--data-plane-host",
    "127.0.0.1:0",
    "--control-plane-host",
    "127.0.0.1:0",
    "--root",
    root,
    file,
  ]);

  let dataPlane = "";
  let controlPlane = "";
  let buf = "";

  const onChunk = (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const found = parseHost(line);
      if (found?.kind === "data") dataPlane = found.host;
      if (found?.kind === "control") controlPlane = found.host;

      if (dataPlane && controlPlane && !ctrl && meinStart === startZaehler) {
        openControlPlane(controlPlane, h);
        // Derselbe Port liefert Vorschau-Frontend und Daten-WebSocket.
        h.onReady(`http://${dataPlane}`);
        verbunden();
      }
    }
  };

  cmd.stdout.on("data", onChunk);
  cmd.stderr.on("data", onChunk); // tinymist loggt die Ports auf stderr
  // Nur vermerken, nicht anzeigen: beim Wechsel der Datei ist das Ende des
  // Vorgängers der Normalfall und würde die Anzeige des Nachfolgers stören.
  cmd.on("close", (d) => console.warn("tinymist beendet, Code", d.code));
  cmd.on("error", (e) => h.onExit(String(e)));

  try {
    child = await cmd.spawn();
  } catch (e) {
    // Ohne das hinge die Anzeige still bei "startet…", etwa wenn die Binary
    // fehlt oder die Berechtigung für den Sidecar nicht erteilt ist.
    currentFile = null;
    h.onExit(`tinymist lässt sich nicht starten: ${e}`);
    return;
  }

  // Meldet der Prozess seine Ports nicht, darf er die Warteschlange trotzdem
  // nicht auf Dauer blockieren.
  await Promise.race([stehtBereit, new Promise((r) => setTimeout(r, 20_000))]);
}

function openControlPlane(host: string, h: PreviewHandlers) {
  const ws = new WebSocket(`ws://${host}`);
  ctrl = ws;
  // Bricht die Verbindung weg, den Platz wieder freigeben — sonst gälte die
  // Vorschau als verbunden, obwohl niemand mehr zuhört.
  ws.onclose = () => {
    if (ctrl === ws) ctrl = null;
  };
  ws.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    switch (msg.event) {
      case "editorScrollTo":
        // start ist [zeile, spalte], beide nullbasiert
        h.onEditorScrollTo(msg.filepath, msg.start[0], msg.start[1]);
        break;
      case "compileStatus":
        h.onStatus(msg.kind);
        break;
      case "syncEditorChanges":
        h.onSyncRequest();
        break;
    }
  };
}

const send = (msg: unknown) => {
  if (ctrl?.readyState === WebSocket.OPEN) ctrl.send(JSON.stringify(msg));
};

/** Rendert den Pufferinhalt, ohne dass er auf der Platte liegen muss. */
export const updateMemoryFiles = (files: Record<string, string>) =>
  send({ event: "updateMemoryFiles", files });

export const removeMemoryFiles = (files: string[]) =>
  send({ event: "removeMemoryFiles", files });

/**
 * Cursor im Editor → passende Stelle in der Vorschau anspringen.
 *
 * Die Spalte muss auf etwas Gesetztes zeigen. Bei einer Überschrift liefert
 * Spalte 0 (auf dem "="-Marker) keinen Treffer und die Vorschau bleibt stehen —
 * deshalb zielen Aufrufer für Überschriften auf das Zeilenende.
 */
export const panelScrollTo = (filepath: string, line: number, character: number) =>
  send({ event: "panelScrollTo", filepath, line, character });
