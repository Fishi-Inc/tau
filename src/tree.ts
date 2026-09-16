import { readDir } from "@tauri-apps/plugin-fs";

export type Node = { name: string; path: string; dir: boolean; children: Node[] };

const SKIP = new Set(["node_modules", ".git", "target", "dist", ".svn"]);
const VISIBLE = /\.(typ|bib|yaml|yml|toml|json|png|jpg|jpeg|svg|gif|webp)$/i;

/**
 * Liest den Ordner einmal komplett ein. Typst-Projekte sind klein genug dafür,
 * und Baum wie Schnellsuche greifen danach auf dieselbe Struktur zu.
 * ponytail: einmaliges volles Einlesen, Tiefe auf 8 begrenzt. Bei spürbar
 * großen Ordnern wäre Nachladen beim Aufklappen der nächste Schritt.
 */
export async function loadTree(root: string, depth = 0): Promise<Node[]> {
  if (depth > 8) return [];
  let entries;
  try {
    entries = await readDir(root);
  } catch {
    return [];
  }
  // Trennzeichen vom Wurzelpfad übernehmen, damit Pfade nativ bleiben —
  // tinymist bekommt sie so zurück, wie das Betriebssystem sie schreibt.
  const sep = root.includes("\\") ? "\\" : "/";
  const out: Node[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const path = `${root}${sep}${e.name}`;
    if (e.isDirectory) {
      const children = await loadTree(path, depth + 1);
      if (children.length) out.push({ name: e.name, path, dir: true, children });
    } else if (VISIBLE.test(e.name)) {
      out.push({ name: e.name, path, dir: false, children: [] });
    }
  }
  // Ordner zuerst, danach alphabetisch
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return out;
}

/** Alle Dateien flach, für die Schnellsuche. */
export function flatten(nodes: Node[], acc: Node[] = []): Node[] {
  for (const n of nodes) {
    if (n.dir) flatten(n.children, acc);
    else acc.push(n);
  }
  return acc;
}

export function renderTree(nodes: Node[], onOpen: (path: string) => void): HTMLElement {
  const ul = document.createElement("ul");
  for (const n of nodes) {
    const li = document.createElement("li");
    if (n.dir) {
      // <details> übernimmt das Auf- und Zuklappen ohne eigenes JavaScript.
      const d = document.createElement("details");
      d.open = true;
      const s = document.createElement("summary");
      s.textContent = n.name;
      d.append(s, renderTree(n.children, onOpen));
      li.append(d);
    } else {
      const a = document.createElement("button");
      a.className = "file";
      a.textContent = n.name;
      a.dataset.path = n.path;
      a.onclick = () => onOpen(n.path);
      li.append(a);
    }
    ul.append(li);
  }
  return ul;
}
