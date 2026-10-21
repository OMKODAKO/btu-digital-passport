// Copies the PDF.js worker into public/ so the browser can load it from our own origin.
import fs from "node:fs";
fs.mkdirSync("public", { recursive: true });
fs.copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
