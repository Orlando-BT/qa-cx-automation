// =============================================================================
// construccion_prompt_datos_referencia.js
// -----------------------------------------------------------------------------
// Utilidades SOLO para pruebas y para la prueba B de verificación (no son
// código de producción: en n8n los datos llegan de Google Sheets ya como filas).
//
// Lee los datos de referencia de datos/ y los convierte en filas con las
// columnas de contrato/sheets.md:
//   - datos/catalogo_temas.csv  -> filas de catalogo_temas
//   - datos/base_conocimiento.md -> filas de base_conocimiento
//   - datos/cuentas.csv          -> filas de cuentas
// Nunca lee datos/lotes/ (las conversaciones del lote de calibración no se usan
// en pruebas del evaluador ni se envían a OpenAI fuera del flujo oficial).
//
// También define una conversación ficticia mínima, ya enmascarada, coherente con
// contrato/ejemplos/llm_output_ejemplo.json (mensaje 1 del cliente, mensaje 2
// del agente con el error "aver"). Es ilustrativa, como el ejemplo del contrato.
// =============================================================================

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');

// CSV sencillo con comillas dobles (RFC 4180). Devuelve filas como objetos con
// los nombres de la primera línea.
function leerCsv(texto) {
  const filas = [];
  let campo = '';
  let fila = [];
  let enComillas = false;
  const t = texto.replace(/\r\n/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  const [encabezado, ...resto] = filas.filter((f) => f.length > 1 || f[0] !== '');
  return resto.map((f) => Object.fromEntries(encabezado.map((h, i) => [h, f[i] ?? ''])));
}

// Convierte datos/base_conocimiento.md (formato documentado al inicio de ese
// archivo) en filas de la hoja base_conocimiento.
function leerBaseConocimientoMd(texto) {
  const t = texto.replace(/\r\n/g, '\n');
  const bloques = t.split(/\n## (?=KB-\d{2}\n)/).slice(1);
  return bloques.map((bloque) => {
    const fila = {};
    for (const m of bloque.matchAll(/^- \*\*([a-z_]+):\*\* (.*)$/gm)) fila[m[1]] = m[2].trim();
    const secciones = bloque.split(/\n### /).slice(1);
    for (const s of secciones) {
      const salto = s.indexOf('\n');
      const nombre = s.slice(0, salto).trim();
      let valor = s.slice(salto + 1).split(/\n---/)[0].trim();
      if (valor === '_(vacío)_') valor = '';
      fila[nombre] = valor;
    }
    return fila;
  });
}

function cargarCatalogo() {
  return leerCsv(fs.readFileSync(path.join(RAIZ, 'datos', 'catalogo_temas.csv'), 'utf8'));
}
function cargarBase() {
  return leerBaseConocimientoMd(fs.readFileSync(path.join(RAIZ, 'datos', 'base_conocimiento.md'), 'utf8'));
}
function cargarCuentas() {
  return leerCsv(fs.readFileSync(path.join(RAIZ, 'datos', 'cuentas.csv'), 'utf8'));
}
function cargarEsquemaLlm() {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato', 'llm_output.schema.json'), 'utf8'));
}
function cargarEjemploLlm() {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato', 'ejemplos', 'llm_output_ejemplo.json'), 'utf8'));
}
function cargarPlantillaEvaluador(version = 'evaluador_ce_v1') {
  return fs.readFileSync(path.join(RAIZ, 'prompts', `${version}.md`), 'utf8');
}

// Conversación ficticia enmascarada (forma de JS-2: n, emisor, texto).
const CONVERSACION_EJEMPLO = [
  { n: 1, emisor: 'cliente', timestamp: '2026-10-21T10:02:11', texto: 'Hola, soy [NOMBRE_1]. Necesito cancelar una factura que salió con el monto equivocado, me preocupa que ya la vio mi cliente.' },
  { n: 2, emisor: 'agente', timestamp: '2026-10-21T10:03:05', texto: 'Hola, [NOMBRE_1], entiendo tu preocupación. Vamos aver: ¿me compartes el folio? Veo en tu cuenta la factura A-120 timbrada ayer.' },
];

// Config mínima para JS-4 (claves de contrato/config.md ya resueltas para ce).
const CONFIG_EJEMPLO = {
  modelo_evaluador: 'gpt-6-luna',
  llm_temperatura: '0',
  version_prompt: 'evaluador_ce_v1',
  reintentos_validacion_llm: '2',
  max_tokens_evaluador: '8000', // texto crudo de Sheets; JS-1 lo convierte a número
};

module.exports = {
  RAIZ,
  leerCsv,
  leerBaseConocimientoMd,
  cargarCatalogo,
  cargarBase,
  cargarCuentas,
  cargarEsquemaLlm,
  cargarEjemploLlm,
  cargarPlantillaEvaluador,
  CONVERSACION_EJEMPLO,
  CONFIG_EJEMPLO,
};
