/**
 * Ayuda de pruebas: lee de contrato/sheets.md las columnas exactas de una hoja, en orden.
 * Sirve para comprobar que las filas que arma el código tienen las columnas del contrato.
 */
const fs = require('node:fs');
const path = require('node:path');

const TEXTO = fs.readFileSync(path.join(__dirname, '..', '..', 'contrato', 'sheets.md'), 'utf8');

/** Nombres de columna de la hoja `nombreHoja`, en el orden de la tabla (primera columna numerada). */
function columnasDeHoja(nombreHoja) {
  const inicio = TEXTO.indexOf(`\n## \`${nombreHoja}\``);
  if (inicio < 0) throw new Error(`hoja no encontrada en sheets.md: ${nombreHoja}`);
  const resto = TEXTO.slice(inicio + 1);
  const fin = resto.indexOf('\n## ', 3);
  const seccion = fin < 0 ? resto : resto.slice(0, fin);
  const columnas = [];
  for (const linea of seccion.split('\n')) {
    const m = /^\| (\d+) \| `([a-z_0-9]+)` \|/.exec(linea);
    if (m) columnas.push(m[2]);
  }
  return columnas;
}

module.exports = { columnasDeHoja };
