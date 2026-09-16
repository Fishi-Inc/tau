import { expect, test } from "bun:test";
import { veraltete, naechsteNummer, nummer, ordnerFuer, wurzel } from "./versions";
import { istTemplate, istBild, istTypst } from "./state";

test("veraltete behält die fünf jüngsten Stände", () => {
  const staende = ["Version 1.typ", "Version 2.typ", "Version 3.typ", "Version 4.typ", "Version 5.typ"];
  // genau fünf: nichts fliegt raus
  expect(veraltete(staende)).toEqual([]);
  // weniger als fünf: auch nicht
  expect(veraltete(staende.slice(0, 3))).toEqual([]);

  // sechster Stand kommt dazu -> der älteste muss weg
  expect(veraltete([...staende, "Version 6.typ"])).toEqual(["Version 1.typ"]);

  // Reihenfolge der Eingabe darf egal sein
  expect(veraltete([...staende].reverse().concat("Version 6.typ"))).toEqual(["Version 1.typ"]);

  // zweistellig: verglichen wird als Zahl, nicht als Text
  const viele = Array.from({ length: 12 }, (_, i) => `Version ${i + 1}.typ`);
  expect(veraltete(viele)).toHaveLength(7);
  expect(veraltete(viele)).toEqual(expect.arrayContaining(["Version 1.typ", "Version 7.typ"]));
  expect(veraltete(viele)).not.toContain("Version 8.typ");
  expect(veraltete(viele)).not.toContain("Version 12.typ");

  // Fremdes im Ordner wird nicht angefasst
  expect(veraltete([...staende, "Version 6.typ", "notizen.txt"])).toEqual(["Version 1.typ"]);
});

test("nummer liest die Zählung, naechsteNummer zählt weiter", () => {
  expect(nummer("Version 3.typ")).toBe(3);
  expect(nummer("Version 12.bib")).toBe(12);
  expect(nummer("main.typ")).toBe(null);
  expect(nummer("Version.typ")).toBe(null);

  expect(naechsteNummer([])).toBe(1);
  // die alten sind weggeräumt, die Zählung läuft trotzdem weiter
  expect(naechsteNummer(["Version 8.typ", "Version 9.typ", "Version 10.typ"])).toBe(11);
  expect(naechsteNummer(["quellen.bib"])).toBe(1);
});

test("die Stände liegen im versteckten .v des Projektordners", () => {
  // Trennzeichen des Pfades bleibt erhalten
  expect(wurzel("D:\\Projekt")).toBe("D:\\Projekt\\.v");
  expect(ordnerFuer("D:\\Projekt\\main.typ")).toBe("D:\\Projekt\\.v\\main.typ");
  expect(ordnerFuer("/home/x/kapitel/eins.typ")).toBe("/home/x/kapitel/.v/eins.typ");
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
