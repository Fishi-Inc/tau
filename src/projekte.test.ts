import { expect, test } from "bun:test";
import { einreihen, HOECHSTZAHL } from "./projekte";

test("einreihen stellt nach vorn, ohne Doppelte", () => {
  expect(einreihen([], "/a")).toEqual(["/a"]);
  expect(einreihen(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
  // Ein erneut geöffnetes Projekt rutscht nach oben statt ein zweites Mal
  // in der Liste zu stehen.
  expect(einreihen(["/a", "/b"], "/b")).toEqual(["/b", "/a"]);
});

test("einreihen kappt die Liste", () => {
  let liste: string[] = [];
  for (let i = 0; i < HOECHSTZAHL + 5; i++) liste = einreihen(liste, `/p${i}`);
  expect(liste.length).toBe(HOECHSTZAHL);
  expect(liste[0]).toBe(`/p${HOECHSTZAHL + 4}`);
});
