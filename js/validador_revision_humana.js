/**
 * Validador de FORMA de la hoja `revision_humana` (calificación humana a ciegas).
 *
 * Qué hace: revisa que el CSV exportado esté completo y bien escrito
 * (columnas, valores permitidos, fechas, filas esperadas).
 * Qué NO hace: no compara contra la verdad del escenario ni contra las evaluaciones del
 * sistema. Tampoco califica ni sugiere calificaciones: solo revisa la forma.
 *
 * Uso por línea de comandos:
 *   node js/validador_revision_humana.js <ruta.csv> [--esperadas N]     (N por defecto: 24)
 * Código de salida: 0 = sin errores (las advertencias NUNCA lo cambian),
 *                   1 = hay errores, 2 = mal uso (falta ruta, archivo ilegible).
 *
 * Privacidad: la salida nunca imprime el contenido de `texto_legible` ni de `comentarios_humano`.
 *
 * Fuente única de columnas: contrato/sheets.md, leída con js/tests/columnas_contrato.js.
 * Así no hay una segunda lista escrita a mano que pueda quedar desfasada del contrato.
 */
'use strict';

const fs = require('node:fs');
const { columnasDeHoja } = require('./tests/columnas_contrato.js');

// ---------------------------------------------------------------------------
// 1. Configuración derivada del contrato (nada de listas escritas a mano)
// ---------------------------------------------------------------------------

/** Valores permitidos (contrato/sheets.md, sección revision_humana, y glosario). */
const VALORES = {
  seccion: ['cumple', 'parcial', 'no_cumple', 'no_aplica'], // resultado_seccion
  subelemento: ['cumple', 'no_cumple', 'no_aplica'], //          resultado_subelemento (clave e identidad)
  critico: ['si', 'no'], //                                      valor_humano_critico
};

/**
 * Tipo de una columna h_* según su prefijo:
 *   h_seccion__*  -> 'seccion'
 *   h_critico__*  -> 'critico'
 *   cualquier otra h_<algo>__* (clave de sección o identidad) -> 'subelemento'
 * Devuelve null si la columna no empieza con h_.
 */
function tipoDeColumna(nombre) {
  const m = /^h_([a-z_]+?)__/.exec(nombre);
  if (!m) return null;
  if (m[1] === 'seccion') return 'seccion';
  if (m[1] === 'critico') return 'critico';
  return 'subelemento';
}

/** Columnas esperadas, en el orden del contrato. Se lee aquí y no al cargar el módulo para poder probarlo. */
function columnasEsperadas() {
  return columnasDeHoja('revision_humana');
}

/** Nombres de las secciones, tomados de las columnas h_seccion__<id>. */
function seccionesDe(columnas) {
  return columnas.filter((c) => c.startsWith('h_seccion__')).map((c) => c.slice('h_seccion__'.length));
}

// Contradicciones de definición (rubrica.md §2.3 y §5): un crítico ligado a un subelemento
// solo puede ser "si" si ese subelemento fue calificado "no_cumple".
// Cada regla: [crítico, [subelementos de los que basta que uno sea no_cumple]]
const CONTRADICCIONES = [
  ['h_critico__tipificacion_incorrecta', ['h_recapitulacion__tipificacion']],
  ['h_critico__no_toma_a_tiempo', ['h_apertura__toma_a_tiempo']],
  // validacion_identidad: basta con que ALGÚN h_identidad__* sea no_cumple (se calcula abajo)
  ['h_critico__validacion_identidad', 'IDENTIDAD'],
];

// ---------------------------------------------------------------------------
// 2. Lector de CSV (sin dependencias): comillas, comillas dobles escapadas,
//    saltos de línea dentro de campos y BOM al inicio.
// ---------------------------------------------------------------------------

/**
 * Convierte texto CSV en una lista de filas (cada fila = lista de textos).
 * Recorre carácter por carácter con una bandera "dentroDeComillas".
 * Lanza Error si el archivo termina con unas comillas sin cerrar.
 */
function parsearCSV(texto) {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // quita el BOM
  const filas = [];
  let fila = [];
  let campo = '';
  let dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentro) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } // "" dentro de comillas = una comilla
        else dentro = false; //                              comilla de cierre
      } else {
        campo += c; // incluye saltos de línea dentro del campo
      }
    } else if (c === '"') {
      dentro = true;
    } else if (c === ',') {
      fila.push(campo); campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++; // \r\n cuenta como un solo salto
      fila.push(campo); campo = '';
      filas.push(fila); fila = [];
    } else {
      campo += c;
    }
  }
  if (dentro) throw new Error('CSV mal formado: comillas sin cerrar al final del archivo');
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); } // última fila sin salto final
  return filas;
}

// ---------------------------------------------------------------------------
// 3. Utilidades de validación
// ---------------------------------------------------------------------------

/** ¿Es una fecha-hora con forma AAAA-MM-DD[T o espacio]HH:MM[:SS] y valores reales? */
function esFechaHora(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(valor);
  if (!m) return false;
  const [anio, mes, dia, hh, mm, ss] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number);
  if (mes < 1 || mes > 12 || hh > 23 || mm > 59 || ss > 59) return false;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia; // descarta 31 de febrero, etc.
}

/**
 * Regla D1 (rubrica.md §2.1) calculada SOLO con los subelementos clave que tienen columna.
 * Devuelve el motivo (texto corto) si la sección calificada difiere de lo que daría D1, o null.
 * Los complementarios no tienen columna: por eso esto es solo informativo.
 */
function diferenciaD1(seccionHumana, clave) {
  const aplicables = clave.filter((v) => v !== 'no_aplica');
  const hayFallo = aplicables.includes('no_cumple');
  if (hayFallo && seccionHumana !== 'no_cumple') return 'clave no_cumple y sección no es no_cumple';
  if (seccionHumana === 'no_aplica' && aplicables.length > 0) return 'sección no_aplica con clave aplicables';
  if (seccionHumana !== 'no_aplica' && aplicables.length === 0 && clave.length > 0) {
    return 'sección aplicable sin clave aplicables';
  }
  return null;
}

/**
 * ¿La fila anota la diferencia? Busca "D1:" en comentarios_humano y, en el mismo renglón,
 * el nombre de la sección (ej. "D1: apertura"). No se imprime nada del comentario.
 */
function estaAnotada(comentarios, seccion) {
  const re = /D1:([^\n\r]*)/g;
  let m;
  while ((m = re.exec(comentarios)) !== null) {
    if (new RegExp(`(^|[^a-z_])${seccion}($|[^a-z_])`).test(m[1])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 4. Validación principal (función pura: texto CSV -> resultado)
// ---------------------------------------------------------------------------

/**
 * @param {string} textoCSV  contenido del archivo
 * @param {{esperadas?: number}} [opciones]
 * @returns {{filas:number, errores:Array<{fila:number|null,columna:string|null,motivo:string}>,
 *            advertencias:Array<{fila:number,seccion:string,anotada:boolean}>,
 *            totalAdvertencias:number, advertenciasAnotadas:number}}
 * Numeración: "fila 1" es el encabezado, así que el primer dato es la fila 2 (como en Google Sheets).
 */
function validarRevisionHumana(textoCSV, opciones = {}) {
  const esperadas = opciones.esperadas === undefined ? 24 : opciones.esperadas;
  const errores = [];
  const advertencias = [];
  const salida = () => ({
    filas: Math.max(0, datos.length),
    errores,
    advertencias,
    totalAdvertencias: advertencias.length,
    advertenciasAnotadas: advertencias.filter((a) => a.anotada).length,
  });
  let datos = [];

  let tabla;
  try {
    tabla = parsearCSV(textoCSV);
  } catch (e) {
    errores.push({ fila: null, columna: null, motivo: e.message });
    return salida();
  }

  // --- Encabezado ---
  const esperado = columnasEsperadas();
  const encabezado = (tabla[0] || []).map((c) => c.trim());
  const faltantes = esperado.filter((c) => !encabezado.includes(c));
  const sobrantes = encabezado.filter((c) => !esperado.includes(c));
  const repetidas = encabezado.filter((c, i) => encabezado.indexOf(c) !== i);
  if (faltantes.length) errores.push({ fila: 1, columna: null, motivo: `encabezado: columnas faltantes: ${faltantes.join(', ')}` });
  if (sobrantes.length) errores.push({ fila: 1, columna: null, motivo: `encabezado: columnas sobrantes: ${sobrantes.join(', ')}` });
  if (repetidas.length) errores.push({ fila: 1, columna: null, motivo: `encabezado: columnas repetidas: ${repetidas.join(', ')}` });
  if (!faltantes.length && !sobrantes.length && !repetidas.length && encabezado.join('|') !== esperado.join('|')) {
    errores.push({ fila: 1, columna: null, motivo: 'encabezado: las columnas están en distinto orden que el contrato' });
  }
  if (errores.length) return salida(); // sin encabezado correcto no se puede interpretar el resto

  // Filas de datos: se ignoran las completamente vacías (por ejemplo, saltos de línea al final).
  datos = [];
  tabla.slice(1).forEach((campos, i) => {
    if (campos.every((c) => c.trim() === '')) return;
    datos.push({ numero: i + 2, campos });
  });

  if (datos.length !== esperadas) {
    errores.push({ fila: null, columna: null, motivo: `se esperaban ${esperadas} filas de datos y hay ${datos.length}` });
  }

  const indice = Object.fromEntries(esperado.map((c, i) => [c, i]));
  const columnasH = esperado.filter((c) => c.startsWith('h_'));
  const secciones = seccionesDe(esperado);
  const vistos = new Set();

  for (const { numero, campos } of datos) {
    const err = (columna, motivo) => errores.push({ fila: numero, columna, motivo });
    if (campos.length !== esperado.length) {
      err(null, `número de campos ${campos.length}, se esperaban ${esperado.length}`);
      continue;
    }
    const val = (col) => campos[indice[col]].trim();

    // conversation_id: obligatorio y único
    const id = val('conversation_id');
    if (id === '') err('conversation_id', 'vacío');
    else if (vistos.has(id)) err('conversation_id', 'duplicado');
    else vistos.add(id);

    // estado_revision debe ser 'calificada'
    if (val('estado_revision') !== 'calificada') err('estado_revision', "debe ser 'calificada'");

    // calificado_en: fecha-hora válida
    const cal = val('calificado_en');
    if (cal === '') err('calificado_en', 'vacío');
    else if (!esFechaHora(cal)) err('calificado_en', 'no es una fecha-hora válida (AAAA-MM-DD HH:MM[:SS])');

    // Columnas h_*: ninguna vacía y con valor permitido para su tipo
    for (const col of columnasH) {
      const v = val(col);
      if (v === '') { err(col, 'vacía'); continue; }
      const permitidos = VALORES[tipoDeColumna(col)];
      if (!permitidos.includes(v)) err(col, `valor no permitido (permitidos: ${permitidos.join('/')})`);
    }

    // Crítico "si" exige comentario (sin imprimirlo)
    const comentarios = campos[indice.comentarios_humano];
    for (const col of columnasH.filter((c) => tipoDeColumna(c) === 'critico')) {
      if (val(col) === 'si' && comentarios.trim() === '') err('comentarios_humano', `vacío con ${col}=si`);
    }

    // Contradicciones de definición
    const identidadCols = columnasH.filter((c) => c.startsWith('h_identidad__'));
    for (const [critico, ligados] of CONTRADICCIONES) {
      if (val(critico) !== 'si') continue;
      const lista = ligados === 'IDENTIDAD' ? identidadCols : ligados;
      const valores = lista.map(val);
      const todosValidos = valores.every((v) => VALORES.subelemento.includes(v));
      if (todosValidos && !valores.includes('no_cumple')) {
        err(critico, `=si sin ${lista.join(' o ')} = no_cumple`);
      }
    }

    // Advertencias D1 (nunca bloquean)
    for (const s of secciones) {
      const hum = val(`h_seccion__${s}`);
      const clave = columnasH
        .filter((c) => c.startsWith(`h_${s}__`))
        .map(val);
      if (!VALORES.seccion.includes(hum) || !clave.every((v) => VALORES.subelemento.includes(v))) continue;
      if (diferenciaD1(hum, clave)) {
        advertencias.push({ fila: numero, seccion: s, anotada: estaAnotada(comentarios, s) });
      }
    }
  }
  return salida();
}

// ---------------------------------------------------------------------------
// 5. Resumen para consola (sin contenido de texto_legible ni de comentarios)
// ---------------------------------------------------------------------------

function formatearResumen(r) {
  const l = [];
  l.push('Validación de forma de revision_humana');
  l.push(`Filas de datos: ${r.filas}`);
  l.push(`Errores: ${r.errores.length}`);
  l.push(`Advertencias D1 (informativas, no bloquean): ${r.totalAdvertencias}`);
  l.push(`Advertencias anotadas (comentario con "D1: <sección>"): ${r.advertenciasAnotadas}`);
  if (r.errores.length) {
    l.push('', 'Errores:');
    for (const e of r.errores) {
      const donde = [e.fila ? `fila ${e.fila}` : null, e.columna ? `columna ${e.columna}` : null].filter(Boolean).join(', ');
      l.push(`  ${donde ? donde + ': ' : ''}${e.motivo}`);
    }
  }
  if (r.totalAdvertencias) {
    l.push('', 'Advertencias:');
    for (const a of r.advertencias) l.push(`  fila ${a.fila}, seccion ${a.seccion}${a.anotada ? ' (anotada)' : ''}`);
  }
  l.push('', r.errores.length ? 'RESULTADO: CON ERRORES' : 'RESULTADO: SIN ERRORES');
  return l.join('\n');
}

// ---------------------------------------------------------------------------
// 6. CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  let ruta = null;
  let esperadas = 24;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--esperadas') {
      esperadas = Number(args[++i]);
      if (!Number.isInteger(esperadas) || esperadas < 0) { console.error('--esperadas requiere un entero >= 0'); return 2; }
    } else if (!ruta) ruta = args[i];
    else { console.error(`argumento no reconocido: ${args[i]}`); return 2; }
  }
  if (!ruta) { console.error('Uso: node js/validador_revision_humana.js <ruta.csv> [--esperadas N]'); return 2; }
  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch (e) { console.error(`No se pudo leer el archivo: ${e.code || e.message}`); return 2; }
  const r = validarRevisionHumana(texto, { esperadas });
  console.log(formatearResumen(r));
  return r.errores.length ? 1 : 0; // las advertencias nunca cambian el código de salida
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = {
  parsearCSV, validarRevisionHumana, formatearResumen, esFechaHora, diferenciaD1,
  estaAnotada, tipoDeColumna, columnasEsperadas, VALORES,
};
