import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/*
 * ISS-050: the pdf.js worker is bundled (same origin) instead of loaded from
 * a CDN. It must be EXACTLY the pdfjs-dist version react-pdf uses: pdf.js
 * refuses a worker of another version. react-pdf pins pdfjs-dist exactly.
 * This package no longer declares a pdfjs-dist of its own (the unrelated ^6
 * declaration was removed in Wave 6), but `pdfjs-dist` is still resolved from
 * react-pdf's own location so that no hoisting change can ever pick another
 * copy. vite.config.ts aliases pdfjs-dist to this folder.
 */

const frontendDir = path.dirname(fileURLToPath(import.meta.url));

/** The folder of the pdfjs-dist copy react-pdf resolves. */
export const reactPdfPdfjsDir = (): string => {
  const reactPdfPackage = createRequire(path.join(frontendDir, "package.json")).resolve("react-pdf/package.json");
  return path.dirname(createRequire(reactPdfPackage).resolve("pdfjs-dist/package.json"));
};

/** The version of that copy (equal to react-pdf's exact pin). */
export const reactPdfPdfjsVersion = (): string =>
  JSON.parse(fs.readFileSync(path.join(reactPdfPdfjsDir(), "package.json"), "utf8")).version;
