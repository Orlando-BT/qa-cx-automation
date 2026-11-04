/**
 * Pruebas del validador de forma de revision_humana.
 * Todo con filas sintéticas inventadas (SINT-001...). No se lee ningún dato del lote real.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const V = require('../validador_revision_humana');
const { columnasDeHoja } = require('./columnas_contrato');

const COLS = columnasDeHoja('revision_humana');
const RUTA_CLI = path.join(__dirname, '..', 'validador_revision_humana.js');

// ---------- Ayudas para armar CSV sintético ----------

/** Fila válida: todo "cumple", críticos "no", identidad "cumple". Se puede pisar con `cambios`. */
function filaValida(id, cambios = {}) {
  const f = {
    conversation_id: id, lote: 'calibracion_v1', tipo_interaccion: 'soporte', agente: 'Agente Sintetico',
    cuenta_id: 'CTA-SINT', metadatos_caso_legible: 'meta sintetica', texto_legible: '[1] 10:00:00 cliente: hola',
    estado_revision: 'calificada', comentarios_humano: '', calificado_en: '2026-11-04 10:30:00',
  };
  for (const c of COLS) {
    if (c.startsWith('h_critico__')) f[c] = 'no';
    else if (c.startsWith('h_')) f[c] = 'cumple';
  }
  return { ...f, ...cambios };
}

/** Escapa un campo para CSV: comillas si trae coma, comillas o saltos de línea. */
function campoCSV(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function aCSV(filas, { columnas = COLS, fin = '\n', bom = false } = {}) {
  const lineas = [columnas.join(',')];
  for (const f of filas) lineas.push(columnas.map((c) => campoCSV(f[c])).join(','));
  return (bom ? '﻿' : '') + lineas.join(fin) + fin;
}

/** N filas válidas con IDs SINT-001... */
function lote(n, cambiosPorFila = {}) {
  return Array.from({ length: n }, (_, i) => {
    const id = `SINT-${String(i + 1).padStart(3, '0')}`;
    return filaValida(id, cambiosPorFila[i] || {});
  });
}

const validar = (filas, op = { esperadas: filas.length }, o = {}) => V.validarRevisionHumana(aCSV(filas, o), op);
const hay = (r, fila, columna) => r.errores.some((e) => e.fila === fila && e.columna === columna);

// ---------- Sincronía con el contrato ----------

test('el contrato tiene 42 columnas h_* (8 secciones + 19 clave + 3 identidad + 12 críticos)', () => {
  const h = COLS.filter((c) => c.startsWith('h_'));
  assert.equal(h.length, 42);
  assert.equal(h.filter((c) => c.startsWith('h_seccion__')).length, 8);
  assert.equal(h.filter((c) => c.startsWith('h_critico__')).length, 12);
  assert.equal(h.filter((c) => c.startsWith('h_identidad__')).length, 3);
  assert.equal(COLS.length, 52);
  assert.deepEqual(V.columnasEsperadas(), COLS);
});

test('tipoDeColumna clasifica por prefijo', () => {
  assert.equal(V.tipoDeColumna('h_seccion__apertura'), 'seccion');
  assert.equal(V.tipoDeColumna('h_critico__abandono'), 'critico');
  assert.equal(V.tipoDeColumna('h_identidad__pide_datos'), 'subelemento');
  assert.equal(V.tipoDeColumna('h_cierre__agradece'), 'subelemento');
  assert.equal(V.tipoDeColumna('lote'), null);
});

// ---------- Caso válido ----------

test('caso válido: 24 filas sin errores ni advertencias', () => {
  const r = V.validarRevisionHumana(aCSV(lote(24)));
  assert.equal(r.filas, 24);
  assert.equal(r.errores.length, 0);
  assert.equal(r.totalAdvertencias, 0);
});

test('acepta valores no_aplica, parcial en secciones y críticos "si" con comentario', () => {
  const r = validar(lote(1, {
    0: {
      h_seccion__ayuda_adicional: 'no_aplica', h_ayuda_adicional__encuesta: 'no_aplica',
      h_ayuda_adicional__ofrece_ayuda_adicional: 'no_aplica', h_seccion__empatia: 'parcial',
      h_critico__abandono: 'si', comentarios_humano: 'nota propia',
    },
  }));
  assert.equal(r.errores.length, 0);
});

// ---------- Encabezado ----------

test('encabezado: columna faltante', () => {
  const cols = COLS.filter((c) => c !== 'h_cierre__despedida');
  const r = validar(lote(2), { esperadas: 2 }, { columnas: cols });
  assert.ok(r.errores.some((e) => /faltantes: h_cierre__despedida/.test(e.motivo)));
});

test('encabezado: columna sobrante', () => {
  const cols = [...COLS, 'extra'];
  const r = validar(lote(2), { esperadas: 2 }, { columnas: cols });
  assert.ok(r.errores.some((e) => /sobrantes: extra/.test(e.motivo)));
});

test('encabezado: orden distinto', () => {
  const cols = COLS.slice();
  [cols[8], cols[9]] = [cols[9], cols[8]];
  const r = validar(lote(2), { esperadas: 2 }, { columnas: cols });
  assert.ok(r.errores.some((e) => /distinto orden/.test(e.motivo)));
});

// ---------- Número de filas ----------

test('número de filas distinto al esperado', () => {
  const r = V.validarRevisionHumana(aCSV(lote(23)));
  assert.ok(r.errores.some((e) => /esperaban 24 filas.*hay 23/.test(e.motivo)));
  assert.equal(V.validarRevisionHumana(aCSV(lote(5)), { esperadas: 5 }).errores.length, 0);
});

test('líneas vacías al final no cuentan como filas', () => {
  const r = V.validarRevisionHumana(aCSV(lote(3)) + '\n\n', { esperadas: 3 });
  assert.equal(r.errores.length, 0);
});

// ---------- conversation_id ----------

test('conversation_id duplicado y vacío', () => {
  const filas = lote(3, { 1: { conversation_id: 'SINT-001' }, 2: { conversation_id: '' } });
  const r = validar(filas);
  assert.ok(hay(r, 3, 'conversation_id'));
  assert.ok(hay(r, 4, 'conversation_id'));
});

// ---------- Columnas h_* ----------

test('h_* vacía en cada tipo de columna', () => {
  const r = validar(lote(1, { 0: { h_seccion__cierre: '', h_cierre__agradece: '', h_critico__abandono: '' } }));
  assert.ok(hay(r, 2, 'h_seccion__cierre'));
  assert.ok(hay(r, 2, 'h_cierre__agradece'));
  assert.ok(hay(r, 2, 'h_critico__abandono'));
});

test('valores no permitidos por tipo', () => {
  const r = validar(lote(1, {
    0: {
      h_seccion__apertura: 'si',            // sección: no admite si/no
      h_apertura__aviso_privacidad: 'parcial', // clave: sin parcial
      h_identidad__pide_datos: 'parcial',   // identidad: sin parcial
      h_critico__abandono: 'cumple',        // crítico: solo si/no
    },
  }));
  assert.ok(hay(r, 2, 'h_seccion__apertura'));
  assert.ok(hay(r, 2, 'h_apertura__aviso_privacidad'));
  assert.ok(hay(r, 2, 'h_identidad__pide_datos'));
  assert.ok(hay(r, 2, 'h_critico__abandono'));
});

test('mayúsculas distintas no se aceptan (valores exactos)', () => {
  const r = validar(lote(1, { 0: { h_seccion__apertura: 'Cumple' } }));
  assert.ok(hay(r, 2, 'h_seccion__apertura'));
});

// ---------- estado_revision y calificado_en ----------

test('estado_revision distinto de calificada', () => {
  const r = validar(lote(1, { 0: { estado_revision: 'pendiente' } }));
  assert.ok(hay(r, 2, 'estado_revision'));
});

test('calificado_en vacío o inválido', () => {
  const r = validar(lote(4, {
    0: { calificado_en: '' }, 1: { calificado_en: 'ayer' },
    2: { calificado_en: '2026-02-31 10:00:00' }, 3: { calificado_en: '2026-11-04T10:30:00-06:00' },
  }));
  assert.ok(hay(r, 2, 'calificado_en'));
  assert.ok(hay(r, 3, 'calificado_en'));
  assert.ok(hay(r, 4, 'calificado_en'));
  assert.ok(!hay(r, 5, 'calificado_en')); // ISO con desfase sí es válida
});

test('esFechaHora: casos límite', () => {
  assert.ok(V.esFechaHora('2026-11-04 10:30'));
  assert.ok(V.esFechaHora('2026-11-04T23:59:59Z'));
  assert.ok(!V.esFechaHora('2026-11-04 24:00:00'));
  assert.ok(!V.esFechaHora('04/11/2026 10:30'));
  assert.ok(!V.esFechaHora('2026-11-04'));
});

// ---------- Críticos y comentarios ----------

test('crítico "si" con comentarios_humano vacío', () => {
  const r = validar(lote(2, { 0: { h_critico__abandono: 'si' }, 1: { h_critico__abandono: 'si', comentarios_humano: '   ' } }));
  assert.ok(hay(r, 2, 'comentarios_humano'));
  assert.ok(hay(r, 3, 'comentarios_humano'));
});

// ---------- Contradicciones de definición ----------

test('tipificacion_incorrecta=si sin recapitulacion.tipificacion=no_cumple', () => {
  const r = validar(lote(1, { 0: { h_critico__tipificacion_incorrecta: 'si', comentarios_humano: 'x' } }));
  assert.ok(hay(r, 2, 'h_critico__tipificacion_incorrecta'));
  const ok = validar(lote(1, {
    0: { h_critico__tipificacion_incorrecta: 'si', comentarios_humano: 'x', h_recapitulacion__tipificacion: 'no_cumple', h_seccion__recapitulacion: 'no_cumple' },
  }));
  assert.equal(ok.errores.length, 0);
});

test('no_toma_a_tiempo=si sin apertura.toma_a_tiempo=no_cumple', () => {
  const r = validar(lote(1, { 0: { h_critico__no_toma_a_tiempo: 'si', comentarios_humano: 'x' } }));
  assert.ok(hay(r, 2, 'h_critico__no_toma_a_tiempo'));
  const ok = validar(lote(1, {
    0: { h_critico__no_toma_a_tiempo: 'si', comentarios_humano: 'x', h_apertura__toma_a_tiempo: 'no_cumple', h_seccion__apertura: 'no_cumple' },
  }));
  assert.equal(ok.errores.length, 0);
});

test('validacion_identidad=si sin ningún h_identidad__* = no_cumple', () => {
  const r = validar(lote(1, { 0: { h_critico__validacion_identidad: 'si', comentarios_humano: 'x' } }));
  assert.ok(hay(r, 2, 'h_critico__validacion_identidad'));
  // Basta con uno solo (orden de validación, p. ej.)
  const ok = validar(lote(1, { 0: { h_critico__validacion_identidad: 'si', comentarios_humano: 'x', h_identidad__orden_validacion: 'no_cumple' } }));
  assert.equal(ok.errores.length, 0);
});

// ---------- Advertencias D1 (nunca bloquean) ----------

test('advertencia: clave no_cumple y sección cumple; no bloquea', () => {
  const r = validar(lote(1, { 0: { h_cierre__agradece: 'no_cumple' } }));
  assert.equal(r.errores.length, 0);
  assert.equal(r.totalAdvertencias, 1);
  assert.deepEqual(r.advertencias[0], { fila: 2, seccion: 'cierre', anotada: false });
});

test('advertencia: clave no_cumple y sección parcial', () => {
  const r = validar(lote(1, { 0: { h_cierre__agradece: 'no_cumple', h_seccion__cierre: 'parcial' } }));
  assert.equal(r.totalAdvertencias, 1);
});

test('sin advertencia cuando la sección coincide con D1 (clave no_cumple -> no_cumple)', () => {
  const r = validar(lote(1, { 0: { h_cierre__agradece: 'no_cumple', h_seccion__cierre: 'no_cumple' } }));
  assert.equal(r.totalAdvertencias, 0);
});

test('sin advertencia: complementarios fallidos pueden dar parcial o no_cumple con clave cumple', () => {
  const r = validar(lote(1, { 0: { h_seccion__cierre: 'parcial', h_seccion__apertura: 'no_cumple' } }));
  assert.equal(r.totalAdvertencias, 0);
});

test('advertencia: sección no_aplica con clave aplicables, y al revés', () => {
  const a = validar(lote(1, { 0: { h_seccion__cierre: 'no_aplica' } }));
  assert.equal(a.totalAdvertencias, 1);
  const b = validar(lote(1, {
    0: { h_ayuda_adicional__ofrece_ayuda_adicional: 'no_aplica', h_ayuda_adicional__encuesta: 'no_aplica' },
  }));
  assert.equal(b.totalAdvertencias, 1);
  assert.equal(b.advertencias[0].seccion, 'ayuda_adicional');
  const sinAdv = validar(lote(1, {
    0: { h_seccion__ayuda_adicional: 'no_aplica', h_ayuda_adicional__ofrece_ayuda_adicional: 'no_aplica', h_ayuda_adicional__encuesta: 'no_aplica' },
  }));
  assert.equal(sinAdv.totalAdvertencias, 0);
});

test('advertencia anotada: comentario con "D1:" y la sección; solo cuenta aparte', () => {
  const r = validar(lote(3, {
    0: { h_cierre__agradece: 'no_cumple', comentarios_humano: 'D1: cierre, lo compensó el resto' },
    1: { h_cierre__agradece: 'no_cumple', comentarios_humano: 'D1: apertura' }, // otra sección: no anota
    2: { h_cierre__agradece: 'no_cumple', comentarios_humano: 'cierre sin patron' },
  }));
  assert.equal(r.errores.length, 0);
  assert.equal(r.totalAdvertencias, 3);
  assert.equal(r.advertenciasAnotadas, 1);
  assert.deepEqual(r.advertencias.map((a) => a.anotada), [true, false, false]);
});

test('estaAnotada: "ayuda_adicional" no se confunde con otra sección y acepta varias en el renglón', () => {
  assert.ok(V.estaAnotada('D1: empatia, ayuda_adicional', 'ayuda_adicional'));
  assert.ok(!V.estaAnotada('D1: ayuda_adicional', 'ayuda'));
  assert.ok(V.estaAnotada('texto\nD1: cierre', 'cierre'));
  assert.ok(!V.estaAnotada('cierre', 'cierre'));
});

test('el exit code y la salida con solo advertencias es 0 (CLI)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revh-'));
  const ruta = path.join(dir, 'a.csv');
  fs.writeFileSync(ruta, aCSV(lote(2, { 0: { h_cierre__agradece: 'no_cumple' } })));
  const p = spawnSync(process.execPath, [RUTA_CLI, ruta, '--esperadas', '2'], { encoding: 'utf8' });
  assert.equal(p.status, 0);
  assert.match(p.stdout, /Advertencias D1.*: 1/);
  assert.match(p.stdout, /fila 2, seccion cierre/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- CSV: comillas, saltos de línea, BOM ----------

test('CSV con comillas, comas y saltos de línea dentro de texto_legible y comentarios', () => {
  const filas = lote(2, {
    0: { texto_legible: '[1] 10:00:00 cliente: dijo "hola", ok\n[2] 10:00:05 agente: línea\r\ndos', comentarios_humano: 'a,b\n"c"' },
  });
  const r = validar(filas);
  assert.equal(r.errores.length, 0);
  assert.equal(r.filas, 2);
  const tabla = V.parsearCSV(aCSV(filas));
  assert.equal(tabla[1][COLS.indexOf('texto_legible')], filas[0].texto_legible);
  assert.equal(tabla[1][COLS.indexOf('comentarios_humano')], 'a,b\n"c"');
});

test('CSV con BOM y con saltos CRLF', () => {
  const r = V.validarRevisionHumana(aCSV(lote(3), { bom: true, fin: '\r\n' }), { esperadas: 3 });
  assert.equal(r.errores.length, 0);
});

test('CSV con comillas sin cerrar se reporta como error, no como excepción', () => {
  const r = V.validarRevisionHumana('a,"b\nc');
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0].motivo, /comillas sin cerrar/);
});

test('fila con número de campos distinto', () => {
  const texto = aCSV(lote(1)) + 'SINT-002,solo,tres\n';
  const r = V.validarRevisionHumana(texto, { esperadas: 2 });
  assert.ok(r.errores.some((e) => e.fila === 3 && /número de campos/.test(e.motivo)));
});

// ---------- Privacidad de la salida ----------

test('la salida nunca imprime texto_legible ni comentarios', () => {
  const secreto1 = 'TEXTO-SECRETO-LEGIBLE';
  const secreto2 = 'COMENTARIO-SECRETO';
  const r = validar(lote(1, {
    0: { texto_legible: secreto1, comentarios_humano: secreto2, h_critico__abandono: 'si', h_cierre__agradece: 'no_cumple', estado_revision: 'x' },
  }));
  const salida = V.formatearResumen(r);
  assert.ok(!salida.includes(secreto1));
  assert.ok(!salida.includes(secreto2));
  assert.match(salida, /CON ERRORES/);
});

test('CLI: errores -> exit 1; sin ruta o archivo inexistente -> exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revh-'));
  const ruta = path.join(dir, 'b.csv');
  fs.writeFileSync(ruta, aCSV(lote(2)));
  // por defecto espera 24 filas, así que 2 filas es error
  assert.equal(spawnSync(process.execPath, [RUTA_CLI, ruta], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [RUTA_CLI, ruta, '--esperadas', '2'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [RUTA_CLI], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [RUTA_CLI, path.join(dir, 'no_existe.csv')], { encoding: 'utf8' }).status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
