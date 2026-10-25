// =============================================================================
// encabezados.mjs — imprime la fila 1 (nombres de columna en orden) de cada hoja,
// leída directamente de contrato/sheets.md. Sirve para la carga inicial del libro:
// copias la línea de la hoja y la pegas en la celda A1 (Datos > Dividir texto en columnas).
// Uso: node workflows/herramientas/encabezados.mjs [hoja]
// No escribe archivos. Sin dependencias.
// =============================================================================
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function leerEncabezados(textoSheets) {
  const hojas = new Map();
  let actual = null;
  for (const linea of textoSheets.replace(/\r\n/g, '\n').split('\n')) {
    const h = linea.match(/^## `([a-z_]+)`\s*$/);
    if (h) {
      actual = h[1];
      hojas.set(actual, []);
      continue;
    }
    if (linea.startsWith('## ')) actual = null;
    const fila = actual && linea.match(/^\| (\d+) \| `([a-z0-9_]+)` \|/);
    if (fila) hojas.get(actual).push(fila[2]);
  }
  return hojas;
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const hojas = leerEncabezados(readFileSync(join(RAIZ, 'contrato', 'sheets.md'), 'utf8'));
  const filtro = process.argv[2];
  for (const [hoja, columnas] of hojas) {
    if (filtro && hoja !== filtro) continue;
    console.log(`${hoja} (${columnas.length} columnas):`);
    console.log(columnas.join(','));
    console.log('');
  }
}
