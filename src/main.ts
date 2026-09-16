import "./styles.css";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, writeFile, mkdir, exists, copyFile } from "@tauri-apps/plugin-fs";
import { Command } from "@tauri-apps/plugin-shell";
import { createEditor, setContent, jumpTo, scrollToLine } from "./editor";
import { loadTree, flatten, renderTree, type Node } from "./tree";
import {
  startPreview,
  stopPreview,
  previewMatches,
  updateMemoryFiles,
  removeMemoryFiles,
  panelScrollTo,
} from "./preview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { sichereAlle, ordnerFuer, wurzel, ABSTAND_MS } from "./versions";
import {
  state,
  activeTab,
  isDirty,
  findTab,
  basename,
  dirname,
  istBild,
  istTypst,
  istText,
  istTemplate,
  type Tab,
} from "./state";
import { samePath, parseOutline, pruefeDateiname } from "./lib";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  tree: $("tree"),
  outline: $("outline"),
  tabs: $("tabs"),
  editor: $("editor"),
  bildansicht: $("bildansicht"),
  leer: $("leer"),
  bild: $<HTMLImageElement>("bild"),
  status: $("status"),
  preview: $("preview"),
  frage: $("frage"),
  frageInput: $<HTMLInputElement>("frage-input"),
  frageHinweis: $("frage-hinweis"),
  palette: $("palette"),
  paletteInput: $<HTMLInputElement>("palette-input"),
  paletteList: $<HTMLUListElement>("palette-list"),
};

let tree: Node[] = [];
let files: Node[] = [];
let status = "";

// ---------- Vorschau ----------

/**
 * Wird gesetzt, während ein neuer Rahmen darauf wartet, den alten abzulösen.
 * Der Tausch braucht zwei Signale: der Rahmen ist geladen *und* das Dokument
 * ist übersetzt. Nur auf das Laden zu warten genügt nicht — dann steht das
 * Fenster kurz weiß da, während der Zeichner im Rahmen erst anläuft.
 */
let rahmenIstUebersetzt: (() => void) | null = null;

function zeigeVorschau(url: string) {
  const neu = document.createElement("iframe");
  neu.className = "frame";
  neu.title = "Vorschau";
  el.preview.append(neu);
  el.preview.dataset.live = "1";

  const uebernehmen = () => {
    // Nur der jeweils neueste Rahmen darf übernehmen; ein verspäteter Aufruf
    // eines überholten Wechsels würde sonst den aktuellen wegräumen.
    if (el.preview.querySelector("iframe:last-of-type") !== neu) return;
    rahmenIstUebersetzt = null;
    for (const alt of el.preview.querySelectorAll("iframe")) if (alt !== neu) alt.remove();
    neu.dataset.sichtbar = "1";
  };

  let geladen = false;
  let uebersetzt = false;
  const wennBeides = () => {
    if (!geladen || !uebersetzt) return;
    // Gemessen: zwischen der Fertigmeldung des Servers und dem Moment, in dem
    // der Rahmen das Dokument wirklich zeigt, liegen rund 240 ms. Tauscht man
    // schon vorher, sieht man kurz den leeren Betrachter — den dunklen Rahmen
    // ohne Seite darin.
    // ponytail: fester Vorlauf. Sollte er bei sehr großen Dokumenten nicht
    // reichen, ist das hier die Stellschraube.
    setTimeout(uebernehmen, 400);
  };
  neu.addEventListener("load", () => ((geladen = true), wennBeides()));
  rahmenIstUebersetzt = () => ((uebersetzt = true), wennBeides());
  // ponytail: Notausstieg, falls eines der beiden Signale ausbleibt. Lieber
  // einmal kurz blinken als dauerhaft das alte Dokument zeigen.
  setTimeout(uebernehmen, 2500);

  neu.src = url;
}

function leereVorschau() {
  rahmenIstUebersetzt = null;
  for (const f of el.preview.querySelectorAll("iframe")) f.remove();
  delete el.preview.dataset.live;
}

const previewHandlers = {
  onReady: (url: string) => {
    zeigeVorschau(url);
    // Erstzustand: den Puffer schicken, damit auch ungespeicherte Änderungen stehen.
    const t = activeTab();
    if (t) setTimeout(() => updateMemoryFiles({ [t.path]: t.content }), 300);
  },
  onEditorScrollTo: (filepath: string, line: number, character: number) => {
    const i = state.tabs.findIndex((t) => samePath(t.path, filepath));
    if (i >= 0 && i !== state.active) selectTab(i);
    else if (i < 0) return void openFile(filepath).then(() => jumpTo(view, line, character));
    jumpTo(view, line, character);
  },
  onStatus: (kind: string) => {
    status = kind === "Compiling" ? "kompiliert…" : kind === "CompileSuccess" ? "bereit" : kind;
    if (kind === "CompileSuccess") rahmenIstUebersetzt?.();
    renderStatus();
  },
  onSyncRequest: () => {
    // Server fordert den aktuellen Stand an — alle offenen Puffer schicken.
    const all: Record<string, string> = {};
    for (const t of state.tabs) all[t.path] = t.content;
    if (Object.keys(all).length) updateMemoryFiles(all);
  },
  onExit: (msg: string) => {
    status = msg;
    leereVorschau();
    renderStatus();
  },
};

let vorschauKette: Promise<unknown> = Promise.resolve();

/**
 * Vorschau an den aktiven Tab angleichen.
 *
 * Läuft über eine Warteschlange, weil `selectTab` nicht auf den Start wartet:
 * beim schnellen Wechseln überlappten sich sonst mehrere Starts, beendeten
 * gegenseitig ihre Prozesse und die Anzeige blieb auf "startet…" stehen. Der
 * aktive Tab wird erst beim Dran-Sein gelesen — zwischenzeitlich überholte
 * Wechsel erledigen sich dadurch von selbst.
 */
function syncPreview() {
  vorschauKette = vorschauKette
    .then(async () => {
      const t = activeTab();
      if (!t || !state.root) {
        await stopPreview();
        leereVorschau();
        return;
      }
      // Bilder und Vorlagen uebernehmen die Vorschau nicht — sie bleibt auf dem
      // zuletzt gerenderten Dokument stehen.
      if (!t.rendern) return;
      if (previewMatches(t.path)) {
        updateMemoryFiles({ [t.path]: t.content });
        return;
      }
      // Der alte Rahmen bleibt absichtlich stehen, bis der neue etwas zeigt.
      status = "startet…";
      renderStatus();
      await startPreview(state.root, t.path, previewHandlers);
    })
    .catch((e) => console.warn("Vorschau:", e));
}

// ---------- Dateien und Tabs ----------

async function openFolder() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  await useFolder(picked);
}

/** Ordner laden und merken, damit er beim nächsten Start gleich wieder dasteht. */
async function useFolder(path: string) {
  state.root = path;
  tree = await loadTree(path);
  files = flatten(tree);
  renderTreeUI();
  localStorage.setItem("tau.root", path);
}

async function openFile(path: string) {
  const existing = findTab(path);
  if (existing >= 0) return selectTab(existing);

  // Bilder werden angesehen, nicht als Text geöffnet — sonst stünde der
  // Binärinhalt im Editor.
  if (istBild(path)) {
    state.tabs.push({
      path,
      name: basename(path),
      content: "",
      saved: "",
      eol: "\n",
      bild: true,
      rendern: false,
    });
    return selectTab(state.tabs.length - 1);
  }

  // Alles, was weder Bild noch bekannte Textart ist, bleibt zu. Lieber nichts
  // tun als eine unbekannte Datei versuchsweise als Text zu laden.
  if (!istText(path)) {
    status = `${basename(path)} wird nicht unterstützt`;
    return renderStatus();
  }

  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch {
    status = `kann ${basename(path)} nicht lesen`;
    return renderStatus();
  }
  // CodeMirror arbeitet intern nur mit \n. Das Zeilenende der Datei wird
  // gemerkt und beim Speichern wiederhergestellt — sonst gälte jede
  // CRLF-Datei sofort als geändert und würde beim ersten Speichern
  // vollständig umgeschrieben.
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const content = raw.replace(/\r\n/g, "\n");
  state.tabs.push({
    path,
    name: basename(path),
    content,
    saved: content,
    eol,
    bild: false,
    // Nur Typst-Dateien uebernehmen die Vorschau: eine Literatur- oder
    // Datendatei ergibt fuer sich gesetzt nichts.
    rendern: istTypst(path) && !istTemplate(path),
  });
  selectTab(state.tabs.length - 1);
}

function selectTab(i: number) {
  state.active = i;
  const t = activeTab();
  zeigeAnsicht(t);
  if (t && !t.bild) setContent(view, t.content, t.path);
  renderTabs();
  renderTreeUI();
  renderOutline();
  renderStatus(); // sonst zeigt die Fußzeile noch den Zustand des vorigen Tabs
  syncPreview();
}

/**
 * Der Platz in der Mitte zeigt genau eines: Editor, Bild oder — ohne offene
 * Datei — den Hinweis. Der Editor wird dabei wirklich ausgeblendet, sonst
 * ließe sich in ein Nichts tippen, das niemand speichern kann.
 */
function zeigeAnsicht(t: Tab | null) {
  const bild = !!t?.bild;
  const leer = !t;
  el.editor.hidden = bild || leer;
  el.bildansicht.hidden = !bild;
  el.leer.hidden = !leer;
  // convertFileSrc liefert eine URL fuer das asset-Protokoll; damit laedt das
  // Bild direkt von der Platte, ohne es durch den Arbeitsspeicher zu schleusen.
  el.bild.src = t && bild ? convertFileSrc(t.path) : "";
}

function closeTab(i: number) {
  const [gone] = state.tabs.splice(i, 1);
  if (gone) removeMemoryFiles([gone.path]);
  if (state.tabs.length === 0) {
    state.active = -1;
    zeigeAnsicht(null);
    setContent(view, "");
    el.outline.replaceChildren();
    stopPreview();
    leereVorschau();
  } else {
    selectTab(Math.min(i, state.tabs.length - 1));
    return;
  }
  renderTabs();
  renderStatus();
}

async function save() {
  const t = activeTab();
  if (!t || t.bild || !isDirty(t)) return;
  const out = t.eol === "\r\n" ? t.content.replace(/\n/g, "\r\n") : t.content;
  await writeTextFile(t.path, out);
  t.saved = t.content;
  renderTabs();
}

async function exportPdf() {
  const t = activeTab();
  if (!t || t.bild) return;
  status = "exportiert…";
  renderStatus();
  await save();
  const out = t.path.replace(/\.typ$/i, ".pdf");
  // Ohne --root nimmt tinymist das Arbeitsverzeichnis der App als Projektwurzel
  // und weist jede Datei außerhalb davon ab.
  const root = state.root ?? dirname(t.path);
  const res = await Command.sidecar("bin/tinymist", [
    "compile",
    "--root",
    root,
    t.path,
    out,
  ]).execute();
  status = res.code === 0 ? `PDF: ${basename(out)}` : `Export fehlgeschlagen: ${res.stderr.trim()}`;
  renderStatus();
}

// ---------- Neue Dateien und Bilder ----------

/** Kleines Eingabefeld über dem Fenster. Antwortet mit null bei Abbruch. */
function frage(titel: string, vorgabe = ""): Promise<string | null> {
  el.frage.hidden = false;
  el.frageInput.placeholder = titel;
  el.frageInput.value = vorgabe;
  el.frageHinweis.textContent = titel;
  delete el.frageHinweis.dataset.fehler;
  el.frageInput.focus();

  return new Promise((antwort) => {
    const schliessen = (wert: string | null) => {
      el.frage.hidden = true;
      el.frageInput.onkeydown = null;
      el.frage.onmousedown = null;
      view.focus();
      antwort(wert);
    };
    el.frageInput.onkeydown = (e) => {
      if (e.key === "Escape") schliessen(null);
      if (e.key === "Enter") schliessen(el.frageInput.value);
    };
    el.frage.onmousedown = (e) => {
      if (e.target === el.frage) schliessen(null);
    };
  });
}

/** Legt eine leere Datei im Wurzelordner an und öffnet sie. */
async function neueDatei(endung = ".typ") {
  if (!state.root) return void (status = "erst einen Ordner öffnen"), renderStatus();
  const eingabe = await frage(
    endung === ".bib" ? "Name der Literaturdatei, z. B. quellen" : "Name der neuen Datei, z. B. kapitel",
  );
  if (eingabe === null) return;

  const geprueft = pruefeDateiname(eingabe, endung);
  if ("fehler" in geprueft) {
    status = `nicht angelegt: ${geprueft.fehler}`;
    return renderStatus();
  }
  const sep = state.root.includes("\\") ? "\\" : "/";
  const ziel = `${state.root}${sep}${geprueft.name}`;

  // Eine vorhandene Datei darf nicht stillschweigend überschrieben werden.
  if (await exists(ziel)) {
    status = `${geprueft.name} gibt es schon`;
    return renderStatus();
  }
  await writeTextFile(ziel, "");
  await useFolder(state.root); // Baum neu einlesen
  await openFile(ziel);
  status = `${geprueft.name} angelegt`;
  renderStatus();
}

/**
 * Bilder von der Platte in den Ordner `assets/` neben dem Dokument aufnehmen
 * und im Text verweisen — derselbe Ablauf wie beim Einfügen aus der
 * Zwischenablage, nur mit Dateiauswahl.
 */
async function bildAufnehmen() {
  const t = activeTab();
  if (!t || !state.root) return void (status = "erst eine Datei öffnen"), renderStatus();

  const auswahl = await open({
    multiple: true,
    filters: [{ name: "Bilder", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"] }],
  });
  const quellen = Array.isArray(auswahl) ? auswahl : auswahl ? [auswahl] : [];
  if (!quellen.length) return;

  const sep = t.path.includes("\\") ? "\\" : "/";
  const ordner = `${dirname(t.path)}${sep}assets`;
  await mkdir(ordner, { recursive: true });

  const verweise: string[] = [];
  for (const quelle of quellen) {
    let name = basename(quelle);
    // Gleichnamige Bilder nicht überschreiben, sondern durchnummerieren.
    for (let n = 2; await exists(`${ordner}${sep}${name}`); n++) {
      name = basename(quelle).replace(/(\.[^.]+)$/, `-${n}$1`);
    }
    await copyFile(quelle, `${ordner}${sep}${name}`);
    verweise.push(`#image("assets/${name}")`);
  }

  if (!t.bild) {
    const at = view.state.selection.main;
    const text = verweise.join("\n");
    view.dispatch({
      changes: { from: at.from, to: at.to, insert: text },
      selection: { anchor: at.from + text.length },
    });
  }
  await useFolder(state.root);
  status = `${verweise.length} Bild${verweise.length > 1 ? "er" : ""} aufgenommen`;
  renderStatus();
}

// ---------- Automatische Sicherungen ----------

/** Alle zehn Minuten einen Stand je offener Datei ablegen, fünf werden behalten. */
setInterval(async () => {
  try {
    const anzahl = await sichereAlle(state.tabs);
    if (anzahl) {
      status = `${anzahl} Stand${anzahl > 1 ? "e" : ""} gesichert`;
      renderStatus();
    }
  } catch (e) {
    console.warn("Sicherung fehlgeschlagen:", e);
  }
}, ABSTAND_MS);

/** Den Ordner mit den Ständen der offenen Datei im Explorer zeigen. */
async function zeigeStaende() {
  const t = activeTab();
  await openPath(t && !t.bild ? await ordnerFuer(t.path) : await wurzel()).catch(async (e) => {
    // Noch kein Stand abgelegt: dann gibt es den Ordner schlicht nicht.
    console.warn("Ordner nicht vorhanden:", e);
    status = "noch keine Sicherung vorhanden";
    renderStatus();
  });
}

// ---------- Bild aus der Zwischenablage ----------

async function pasteImage(file: File): Promise<string | null> {
  const t = activeTab();
  if (!t) return null;
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  // 2026-09-11T23:18:47.123Z -> 20260911231847 (die 14 Stellen vor dem Punkt)
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const sep = t.path.includes("\\") ? "\\" : "/";
  const dir = `${dirname(t.path)}${sep}assets`;
  const name = `bild-${stamp}.${ext}`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}${sep}${name}`, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    status = `Bild konnte nicht abgelegt werden: ${e}`;
    renderStatus();
    return null;
  }
  // Im Dokument bleibt der Pfad relativ und mit Schrägstrich — so will es Typst.
  return `#image("assets/${name}")`;
}

// ---------- Darstellung ----------

function renderTabs() {
  el.tabs.replaceChildren(
    ...state.tabs.map((t, i) => {
      const b = document.createElement("div");
      b.className = "tab";
      b.dataset.active = i === state.active ? "1" : "";
      b.dataset.dirty = isDirty(t) ? "1" : "";
      b.dataset.still = t.rendern ? "" : "1";
      if (!t.rendern && !t.bild) b.title = "Vorlage — die Vorschau bleibt beim anderen Dokument";
      b.onclick = () => selectTab(i);

      const dot = document.createElement("span");
      dot.className = "dot";
      const label = document.createElement("span");
      label.textContent = t.name;
      const x = document.createElement("span");
      x.className = "close";
      x.textContent = "×";
      x.onclick = (e) => {
        e.stopPropagation();
        closeTab(i);
      };
      b.append(dot, label, x);
      return b;
    }),
  );
  // Bei vielen Tabs liegt der aktive oft außerhalb des sichtbaren Ausschnitts.
  el.tabs
    .querySelector<HTMLElement>('.tab[data-active="1"]')
    ?.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function renderTreeUI() {
  if (!state.root) return;
  el.tree.replaceChildren(renderTree(tree, openFile));
  const cur = activeTab();
  if (cur)
    el.tree
      .querySelectorAll<HTMLElement>(".file")
      .forEach((n) => (n.dataset.current = n.dataset.path === cur.path ? "1" : ""));
}

/** Die Gliederung kommt fertig von tinymist — auch aus eingebundenen Dateien. */
function renderOutline() {
  const t = activeTab();
  if (!t || t.bild) return el.outline.replaceChildren();
  el.outline.replaceChildren(
    ...parseOutline(t.content).map((h) => {
      const b = document.createElement("button");
      b.textContent = h.title;
      b.style.paddingLeft = `${4 + (h.level - 1) * 12}px`;
      b.onclick = () => {
        scrollToLine(view, h.line);
        // Spalte 0 träfe den "="-Marker, auf den die Vorschau nicht springen
        // kann — deshalb auf das Ende der Überschriftenzeile zielen.
        const doc = view.state.doc;
        const zeile = doc.line(Math.min(h.line + 1, doc.lines)).text;
        panelScrollTo(t.path, h.line, zeile.length);
      };
      return b;
    }),
  );
}

function renderStatus() {
  const t = activeTab();
  el.status.replaceChildren();
  const left = document.createElement("span");
  left.textContent = t ? `${status}${isDirty(t) ? " · ungespeichert" : ""}` : status;
  const right = document.createElement("span");
  const knopf = (text: string, bei: () => void) => {
    const a = document.createElement("a");
    a.textContent = text;
    a.style.cursor = "pointer";
    a.style.marginLeft = "14px";
    a.onclick = bei;
    return a;
  };
  // Die Vorlagen-Erkennung geht nach dem Namen; hier lässt sie sich je Tab
  // übersteuern, falls sie danebenliegt.
  if (t && !t.bild)
    right.append(
      knopf(t.rendern ? "Vorschau: an" : "Vorschau: aus", () => {
        t.rendern = !t.rendern;
        renderTabs();
        renderStatus();
        syncPreview();
      }),
    );
  right.append(knopf("Versionen", zeigeStaende));
  if (t && !t.bild) right.append(knopf("PDF", exportPdf));
  el.status.append(left, right);
}

// ---------- Palette: Dateien und Befehle ----------

type Eintrag = { titel: string; zusatz?: string; tun: () => void };

const befehle = (): Eintrag[] => [
  { titel: "Neue Datei anlegen", zusatz: "Strg+N", tun: () => neueDatei() },
  { titel: "Neue Literaturdatei anlegen", zusatz: ".bib", tun: () => neueDatei(".bib") },
  { titel: "Bilder aufnehmen", zusatz: "nach assets/", tun: bildAufnehmen },
  { titel: "Ordner öffnen", tun: openFolder },
  { titel: "Datei suchen", zusatz: "Strg+P", tun: () => setTimeout(() => openPalette("dateien"), 0) },
  { titel: "Versionen dieser Datei zeigen", tun: zeigeStaende },
  { titel: "Als PDF ausgeben", tun: exportPdf },
];

let paletteSel = 0;
let paletteModus: "dateien" | "befehle" = "dateien";

function openPalette(modus: "dateien" | "befehle" = "dateien") {
  if (modus === "dateien" && !files.length) return;
  paletteModus = modus;
  el.palette.hidden = false;
  el.paletteInput.value = "";
  el.paletteInput.placeholder = modus === "dateien" ? "Datei suchen…" : "Befehl…";
  paletteSel = 0;
  fillPalette();
  el.paletteInput.focus();
}

const closePalette = () => {
  el.palette.hidden = true;
  view.focus();
};

/** Die Treffer der aktuellen Betriebsart, einheitlich als Eintraege. */
function matches(): Eintrag[] {
  const q = el.paletteInput.value.toLowerCase().trim();
  if (paletteModus === "befehle") {
    return befehle().filter((b) => !q || b.titel.toLowerCase().includes(q));
  }
  const liste = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  return liste.slice(0, 50).map((f) => ({
    titel: f.name,
    zusatz: state.root ? dirname(f.path).slice(state.root.length + 1) : "",
    tun: () => openFile(f.path),
  }));
}

function fillPalette() {
  const list = matches();
  paletteSel = Math.min(paletteSel, Math.max(list.length - 1, 0));
  el.paletteList.replaceChildren(
    ...list.map((eintrag, i) => {
      const li = document.createElement("li");
      li.dataset.sel = i === paletteSel ? "1" : "";
      const name = document.createElement("span");
      name.textContent = eintrag.titel;
      const zusatz = document.createElement("span");
      zusatz.className = "path";
      zusatz.textContent = eintrag.zusatz ?? "";
      li.append(name, zusatz);
      li.onclick = () => {
        closePalette();
        eintrag.tun();
      };
      return li;
    }),
  );
}

el.paletteInput.addEventListener("input", () => {
  paletteSel = 0;
  fillPalette();
});

el.paletteInput.addEventListener("keydown", (e) => {
  const list = matches();
  if (e.key === "Escape") return closePalette();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    paletteSel = (paletteSel + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    fillPalette();
  } else if (e.key === "Enter" && list[paletteSel]) {
    closePalette();
    list[paletteSel].tun();
  }
});

el.palette.addEventListener("mousedown", (e) => {
  if (e.target === el.palette) closePalette();
});

// ---------- Spaltenbreiten ziehen ----------

for (const handle of document.querySelectorAll<HTMLElement>(".drag")) {
  handle.addEventListener("mousedown", (down) => {
    down.preventDefault();
    const left = handle.dataset.target === "left";
    // Solange gezogen wird, nimmt der Vorschau-Rahmen keine Mausereignisse an.
    // Ohne das verschluckt er jede Bewegung, sobald der Zeiger ihn erreicht —
    // die Vorschau ließe sich dann nur kleiner, nie größer ziehen.
    document.body.dataset.ziehen = "1";
    const move = (e: MouseEvent) => {
      const v = left ? e.clientX : window.innerWidth - e.clientX;
      const clamped = Math.max(150, Math.min(v, window.innerWidth - 400));
      document.documentElement.style.setProperty(left ? "--w-left" : "--w-right", `${clamped}px`);
    };
    const up = () => {
      delete document.body.dataset.ziehen;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

// Die Tab-Leiste rollt waagerecht — das Mausrad dreht sich aber senkrecht.
el.tabs.addEventListener(
  "wheel",
  (e) => {
    if (e.deltaY === 0 || e.shiftKey) return; // Shift rollt ohnehin quer
    e.preventDefault();
    el.tabs.scrollLeft += e.deltaY;
  },
  { passive: false },
);

// ---------- Start ----------

let debounce: ReturnType<typeof setTimeout> | undefined;

const view = createEditor(el.editor, {
  onChange: (content) => {
    const t = activeTab();
    if (!t || t.bild) return;
    t.content = content;
    renderTabs();
    renderOutline(); // Gliederung wächst beim Tippen mit
    clearTimeout(debounce);
    debounce = setTimeout(() => updateMemoryFiles({ [t.path]: t.content }), 120);
  },
  onCursor: (line, character) => {
    const t = activeTab();
    if (t) panelScrollTo(t.path, line, character);
  },
  onSave: save,
  onPasteImage: pasteImage,
  onQuickOpen: openPalette,
});

$("open-folder").onclick = openFolder;
$("new-file").onclick = () => neueDatei();
$("add-asset").onclick = bildAufnehmen;

window.addEventListener("keydown", (e) => {
  const strg = e.ctrlKey || e.metaKey;
  if (!strg) return;
  // Bei gedrückter Umschalttaste liefert der Browser Großbuchstaben.
  const taste = e.key.toLowerCase();

  if (taste === "p") {
    e.preventDefault();
    openPalette(e.shiftKey ? "befehle" : "dateien");
  } else if (taste === "n") {
    e.preventDefault();
    neueDatei();
  } else if (taste === "w" && state.active >= 0) {
    e.preventDefault();
    closeTab(state.active);
  }
});

zeigeAnsicht(null);
renderStatus();

// Zuletzt geöffneten Ordner wiederherstellen.
const last = localStorage.getItem("tau.root");
if (last) useFolder(last).catch(() => localStorage.removeItem("tau.root"));
