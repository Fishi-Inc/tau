import { expect, test } from "bun:test";
import { veraltete, ordnerName, zeitstempel } from "./versions";
import { istTemplate, istBild, istTypst } from "./state";

test("veraltete behält die fünf jüngsten Stände", () => {
  // Namen beginnen mit dem Zeitstempel, alphabetisch = chronologisch
  const staende = [
    "2026-09-15_10-00-00.typ",
    "2026-09-15_10-10-00.typ",
    "2026-09-15_10-20-00.typ",
    "2026-09-15_10-30-00.typ",
    "2026-09-15_10-40-00.typ",
  ];
  // genau fünf: nichts fliegt raus
  expect(veraltete(staende)).toEqual([]);
  // weniger als fünf: auch nicht
  expect(veraltete(staende.slice(0, 3))).toEqual([]);

  // sechster Stand kommt dazu -> der älteste muss weg
  expect(veraltete([...staende, "2026-09-15_10-50-00.typ"])).toEqual(["2026-09-15_10-00-00.typ"]);

  // Reihenfolge der Eingabe darf egal sein
  expect(veraltete([...staende].reverse().concat("2026-09-15_10-50-00.typ"))).toEqual([
    "2026-09-15_10-00-00.typ",
  ]);

  // grosser Rückstand: es bleiben genau fünf übrig
  const viele = Array.from({ length: 12 }, (_, i) => `2026-09-15_10-${String(i).padStart(2, "0")}-00.typ`);
  expect(veraltete(viele)).toHaveLength(7);
  expect(veraltete(viele)).not.toContain("2026-09-15_10-11-00.typ");
});

test("ordnerName macht aus einem Pfad einen zulässigen Ordnernamen", () => {
  // Laufwerksdoppelpunkt und Trennzeichen werden beide ersetzt, daher "D--"
  expect(ordnerName("D:\\Code\\tau\\main.typ")).toBe("D--Code-tau-main.typ");
  expect(ordnerName("/home/x/a.typ")).toBe("home-x-a.typ");
  // keine der unter Windows verbotenen Zeichen bleiben übrig
  expect(ordnerName('C:/a?b*c"d<e>f|g.typ')).not.toMatch(/[\\/:*?"<>|]/);
});

test("zeitstempel ist sortierbar und ohne verbotene Zeichen", () => {
  const frueh = zeitstempel(new Date(2026, 8, 15, 9, 5, 3));
  const spaet = zeitstempel(new Date(2026, 8, 15, 14, 30, 0));
  expect(frueh).toBe("2026-09-15_09-05-03");
  expect(frueh < spaet).toBe(true);
  expect(spaet).not.toMatch(/[\\/:*?"<>|]/);
});

test("istTemplate erkennt Vorlagen an Ordner oder Name", () => {
  expect(istTemplate("D:\\Projekt\\templates\\brief.typ")).toBe(true);
  expect(istTemplate("D:/Projekt/template/brief.typ")).toBe(true);
  expect(istTemplate("D:/Projekt/mein-template.typ")).toBe(true);
  // normale Dokumente bleiben unberuehrt
  expect(istTemplate("D:/Projekt/main.typ")).toBe(false);
  expect(istTemplate("D:/Projekt/kapitel/einleitung.typ")).toBe(false);
  // "templates" als Teil eines laengeren Ordnernamens zaehlt nicht
  expect(istTemplate("D:/templatesammlung/main.typ")).toBe(false);
});

test("istBild erkennt die ueblichen Bildformate", () => {
  expect(istBild("a/b/bild.PNG")).toBe(true);
  expect(istBild("a/b/foto.jpeg")).toBe(true);
  expect(istBild("a/b/main.typ")).toBe(false);
});

test("istTypst trennt Dokumente von Beiwerk", () => {
  expect(istTypst("a/main.typ")).toBe(true);
  expect(istTypst("a/MAIN.TYP")).toBe(true);
  // alles andere ergibt fuer sich gesetzt kein Dokument
  expect(istTypst("a/quellen.bib")).toBe(false);
  expect(istTypst("a/daten.yaml")).toBe(false);
  expect(istTypst("a/bild.png")).toBe(false);
});
