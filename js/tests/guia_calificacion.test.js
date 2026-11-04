/**
 * Prueba de la guía de calificación (docs/guia_calificacion.md) contra el contrato.
 *
 * Verifica dos cosas:
 *  1) La guía lista EXACTAMENTE los IDs de rubrica.md: 54 subelementos de sección,
 *     3 de identidad, 12 críticos y 8 secciones (sin faltantes ni sobrantes).
 *  2) Las columnas h_* que cita la guía son exactamente las de contrato/sheets.md (hoja revision_humana).
 *
 * CÓMO DISTINGUE UN ID DE OTROS TEXTOS ENTRE ACENTOS GRAVES (backticks):
 *  La guía usa `acentos graves` para muchas cosas: valores (`cumple`), nombres de hoja
 *  (`revision_humana`), archivos (`contrato/sheets.md`), claves de config
 *  (`umbral_desempate_complementarios = 0.5`), columnas (`h_critico__abandono`), etc.
 *  Se toma el texto de cada par de acentos graves y se clasifica por FORMA:
 *    - ID de criterio:  <palabra_minuscula>.<palabra_minuscula>  (un solo punto, sin barras ni espacios),
 *      por ejemplo `solucion.apego_proceso`. Se excluyen los que terminan en extensión de archivo
 *      (.md, .json, .csv, .js). Todo lo que tenga esa forma DEBE existir en la rúbrica; así un ID
 *      mal escrito (typo) aparece como sobrante en vez de ignorarse.
 *    - Columna h_*:  h_<grupo>__<nombre> (o con comparación, como `h_x__y = no_cumple`: se toma
 *      solo la primera palabra). Los comodines (`h_seccion__*`) y las plantillas (`h_<seccion>__...`)
 *      no coinciden con la forma y se ignoran.
 *    - Cualquier otra cosa (valores, hojas, claves de config, `` vacíos) se ignora.
 *  Por último, una columna h_x__y cuenta también como cita del ID x.y (y h_seccion__s como la
 *  sección s), de modo que la guía puede nombrar un criterio con su ID o con su columna.
 *
 * Los IDs de la rúbrica se extraen con expresiones regulares de las tablas de rubrica.md:
 *  secciones 3.1 a 3.8 (subelementos), sección 4 (identidad) y sección 5 (críticos), más la tabla
 *  de la sección 1 (secciones). Se ignoran otras tablas de rubrica.md que repiten IDs (3.9, 8...).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { columnasDeHoja } = require('./columnas_contrato');

const RAIZ = path.join(__dirname, '..', '..');
const RUBRICA = fs.readFileSync(path.join(RAIZ, 'contrato', 'rubrica.md'), 'utf8');
const RUTA_GUIA = path.join(RAIZ, 'docs', 'guia_calificacion.md');

/** Texto entre dos encabezados (desde `inicio` hasta antes de `fin`). */
function tramo(texto, inicio, fin) {
  const i = texto.search(inicio);
  assert.ok(i >= 0, `no se encontró el encabezado ${inicio}`);
  const resto = texto.slice(i);
  const j = resto.slice(1).search(fin);
  return j < 0 ? resto : resto.slice(0, j + 1);
}

/** Primera columna de las filas de tabla que tienen forma de ID: | `algo.otro` | */
function idsDeTabla(texto, patronId) {
  const ids = [];
  for (const linea of texto.split('\n')) {
    const m = new RegExp(`^\\| \`(${patronId})\` \\|`).exec(linea);
    if (m) ids.push(m[1]);
  }
  return ids;
}

// ---------- IDs de la rúbrica ----------

const SECCIONES = [];
for (const linea of tramo(RUBRICA, /^## 1\. Secciones y pesos/m, /^## 2\. /m).split('\n')) {
  const m = /^\| \d+ \| `([a-z_]+)` \| \d+ \|/.exec(linea);
  if (m) SECCIONES.push(m[1]);
}
const ID_DOTADO = '[a-z_]+\\.[a-z_]+';
const SUBELEMENTOS = [...new Set(idsDeTabla(tramo(RUBRICA, /^### 3\.1 /m, /^### 3\.9 /m), ID_DOTADO))];
const IDENTIDAD = [...new Set(idsDeTabla(tramo(RUBRICA, /^## 4\. /m, /^## 5\. /m), 'identidad\\.[a-z_]+'))];
const CRITICOS = [...new Set(idsDeTabla(tramo(RUBRICA, /^## 5\. /m, /^## 6\. /m), 'critico\\.[a-z_]+'))];

// ---------- Lo que cita la guía ----------

function citas() {
  const guia = fs.readFileSync(RUTA_GUIA, 'utf8');
  const idsDotados = new Set();
  const columnasH = new Set();
  for (const m of guia.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    const primera = t.split(/\s+/)[0];
    if (/^[a-z_]+\.[a-z_]+$/.test(t) && !/\.(md|json|csv|js)$/.test(t)) idsDotados.add(t);
    else if (/^h_[a-z_]+?__[a-z_]+$/.test(primera)) columnasH.add(primera);
  }
  return { idsDotados, columnasH };
}

const diferencia = (a, b) => [...a].filter((x) => !b.has(x)).sort();

// ---------- Pruebas de la extracción (corren aunque no exista la guía) ----------

test('rubrica.md: 8 secciones, 54 subelementos de sección, 3 de identidad y 12 críticos', () => {
  assert.equal(SECCIONES.length, 8);
  assert.equal(SUBELEMENTOS.length, 54);
  assert.equal(IDENTIDAD.length, 3);
  assert.equal(CRITICOS.length, 12);
  // Cada subelemento pertenece a una sección conocida
  for (const id of SUBELEMENTOS) assert.ok(SECCIONES.includes(id.split('.')[0]), id);
});

test('sheets.md (revision_humana): 42 columnas h_* = 8 secciones + 19 clave + 3 identidad + 12 críticos', () => {
  const h = columnasDeHoja('revision_humana').filter((c) => c.startsWith('h_'));
  assert.equal(h.length, 42);
  assert.equal(h.filter((c) => c.startsWith('h_seccion__')).length, 8);
  assert.equal(h.filter((c) => c.startsWith('h_identidad__')).length, 3);
  assert.equal(h.filter((c) => c.startsWith('h_critico__')).length, 12);
  assert.equal(h.length - 8 - 3 - 12, 19);
});

test('las columnas h_* de sheets.md derivan de IDs reales de la rúbrica (regla del glosario)', () => {
  const claves = new Set([...SUBELEMENTOS, ...IDENTIDAD, ...CRITICOS]);
  for (const col of columnasDeHoja('revision_humana').filter((c) => c.startsWith('h_'))) {
    if (col.startsWith('h_seccion__')) {
      assert.ok(SECCIONES.includes(col.slice('h_seccion__'.length)), col);
    } else {
      const id = col.replace(/^h_/, '').replace('__', '.');
      assert.ok(claves.has(id), `${col} no corresponde a un ID de rubrica.md`);
    }
  }
});

// ---------- Pruebas contra la guía ----------

const hayGuia = fs.existsSync(RUTA_GUIA);
const opcionesGuia = hayGuia ? {} : { todo: 'docs/guia_calificacion.md aún no existe (la escribe documentacion)' };

test('la guía lista exactamente los IDs de subelementos, identidad y críticos de rubrica.md', opcionesGuia, () => {
  const { idsDotados, columnasH } = citas();
  // Citas por ID dotado + citas por columna h_x__y convertidas a ID
  const citados = new Set(idsDotados);
  for (const c of columnasH) {
    if (c.startsWith('h_seccion__')) continue;
    citados.add(c.replace(/^h_/, '').replace('__', '.'));
  }
  const esperados = new Set([...SUBELEMENTOS, ...IDENTIDAD, ...CRITICOS]);
  assert.equal(esperados.size, 69);
  assert.deepEqual(diferencia(esperados, citados), [], 'IDs de rubrica.md que la guía no lista');
  assert.deepEqual(diferencia(citados, esperados), [], 'IDs de la guía que no existen en rubrica.md');
});

test('la guía cubre las 8 secciones (h_seccion__*)', opcionesGuia, () => {
  const { columnasH } = citas();
  const citadas = new Set([...columnasH].filter((c) => c.startsWith('h_seccion__')).map((c) => c.slice('h_seccion__'.length)));
  assert.deepEqual([...citadas].sort(), [...SECCIONES].sort());
});

test('las columnas h_* citadas en la guía coinciden exactamente con contrato/sheets.md', opcionesGuia, () => {
  const { columnasH } = citas();
  const contrato = new Set(columnasDeHoja('revision_humana').filter((c) => c.startsWith('h_')));
  assert.equal(contrato.size, 42);
  assert.deepEqual(diferencia(contrato, columnasH), [], 'columnas del contrato que la guía no cita');
  assert.deepEqual(diferencia(columnasH, contrato), [], 'columnas de la guía que no existen en el contrato');
});
