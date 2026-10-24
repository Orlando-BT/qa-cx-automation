/**
 * Ayudas para las pruebas: lectura de los CSV de `datos/`, armado del contexto y
 * ejecución del pipeline completo JS-1 → JS-8 sin n8n.
 * Sin dependencias externas: solo módulos de Node.
 */
const fs = require('node:fs');
const path = require('node:path');

const { prepararContexto, cargarConfig } = require('../normalizacion');
const { extraerYEnmascarar } = require('../enmascaramiento');
const { evaluarReglasJS } = require('../reglas');
const { evaluarReglasHibridas } = require('../reglas_hibridas');
const { construirEvaluacion } = require('../scoring');
const { calcularConsumo, finalizarEvaluacion } = require('../costo');

const RAIZ = path.join(__dirname, '..', '..');

/** Lector de CSV con comillas dobles (RFC 4180): comas y saltos de línea dentro de comillas. */
function leerCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  const t = texto.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
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
  return resto.map((f) => Object.fromEntries(encabezado.map((h, i) => [h, f[i] === undefined ? '' : f[i]])));
}

function leerDatos(nombre) {
  return leerCSV(fs.readFileSync(path.join(RAIZ, 'datos', nombre), 'utf8'));
}

function leerJSON(relativo) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, relativo), 'utf8'));
}

const DATOS = {
  config: leerDatos('config.csv'),
  listas: leerDatos('listas.csv'),
  catalogo: leerDatos('catalogo_temas.csv'),
  cuentas: leerDatos('cuentas.csv'),
};

/** Filas de config con valores reemplazados: {clave: valor_texto}. */
function filasConfigCon(cambios = {}) {
  return DATOS.config.map((f) => (Object.prototype.hasOwnProperty.call(cambios, f.clave) ? { ...f, valor: String(cambios[f.clave]) } : f));
}

function configCE(cambios = {}) {
  return cargarConfig(filasConfigCon(cambios), 'ce');
}

/**
 * Corre JS-1, JS-2 y JS-3. Devuelve el contexto.
 */
function contextoHastaJS3(payload, { configCambios = {}, lote = 'demo', listasExtra = [], listas = null } = {}) {
  const contexto = prepararContexto({
    payload,
    lote,
    filasConfig: filasConfigCon(configCambios),
    filasListas: listas || [...DATOS.listas, ...listasExtra],
    filasCatalogo: DATOS.catalogo,
    filasCuentas: DATOS.cuentas,
  });
  contexto.versiones = { version_reglas: contexto.config.version_reglas, version_prompt: contexto.config.version_prompt };
  contexto.marcas = { recibido_en: '2026-10-21T10:05:00-06:00', iniciado_en: '2026-10-21T10:05:01-06:00' };
  contexto.extraccion = extraerYEnmascarar(contexto);
  contexto.resultados_js = evaluarReglasJS(contexto);
  return contexto;
}

/**
 * Pipeline completo. `llm` es la salida del evaluador (o null si no hay mensajes del agente).
 */
function evaluar(payload, llm, opciones = {}) {
  const contexto = contextoHastaJS3(payload, opciones);
  contexto.llm = contexto.resultados_js.variables.sin_mensajes_agente ? null : llm;
  contexto.resultados_hibridos = evaluarReglasHibridas(contexto);
  const parcial = construirEvaluacion(contexto);
  const consumo = calcularConsumo({
    intentos: contexto.llm ? opciones.intentos || [{ tokens_entrada: 5000, tokens_salida: 900 }] : [],
    sin_mensajes_agente: parcial.sin_mensajes_agente,
    config: contexto.config,
  });
  const evaluacion = finalizarEvaluacion(parcial, consumo, '2026-10-21T10:05:20-06:00');
  return { contexto, evaluacion };
}

/** Busca un criterio por ID en una lista de criterios. */
function criterio(criterios, id) {
  const c = criterios.find((x) => x.id_criterio === id);
  if (!c) throw new Error(`no existe el criterio ${id}`);
  return c;
}

/** Resultado de un criterio [JS] tras JS-3. */
function resultadoJS(payload, id, opciones) {
  return criterio(contextoHastaJS3(payload, opciones).resultados_js.criterios, id);
}

module.exports = { leerCSV, leerJSON, DATOS, RAIZ, filasConfigCon, configCE, contextoHastaJS3, evaluar, criterio, resultadoJS };
