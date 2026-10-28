// =============================================================================
// estructura.test.js — forma de los workflows generados.
// -----------------------------------------------------------------------------
//  - nombres exactos de los 6 workflows y error workflow asignado (menos en 99 Errores);
//  - cada nodo usa un tipo y una typeVersion confirmados en INVENTARIO_NODOS.md (n8n 2.32.6);
//  - conexiones solo entre nodos que existen;
//  - credenciales con marcador; libro de Sheets con <ID_LIBRO_SHEETS>; hojas del contrato;
//  - HTTP de OpenAI/Claude con respuesta completa, "nunca fallar" y salida de error;
//  - Telegram con salida de error conectada (para registrar estado_envio = fallida);
//  - las plantillas son las que escribe construir_plantillas.mjs.
// =============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RAIZ = path.resolve(__dirname, '..', '..');
const DIR = path.join(RAIZ, 'workflows');
const leer = (rel) => JSON.parse(fs.readFileSync(path.join(DIR, rel), 'utf8'));

const ESPERADOS = {
  '00_simulador.json': '00 Simulador',
  '01_ingesta.json': '01 Ingesta',
  '02_evaluacion.json': '02 Evaluación',
  '03_metricas.json': '03 Métricas',
  '04_reproceso.json': '04 Reproceso',
  '99_errores.json': '99 Errores',
};

// Tipo -> versiones confirmadas en el contenedor (INVENTARIO_NODOS.md).
const VERSIONES = {
  'n8n-nodes-base.webhook': [1, 1.1, 2, 2.1],
  'n8n-nodes-base.respondToWebhook': [1, 1.1, 1.2, 1.3, 1.4, 1.5],
  'n8n-nodes-base.formTrigger': [2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6],
  'n8n-nodes-base.code': [2],
  'n8n-nodes-base.if': [2, 2.1, 2.2, 2.3],
  'n8n-nodes-base.switch': [3, 3.1, 3.2, 3.3, 3.4],
  'n8n-nodes-base.wait': [1, 1.1],
  'n8n-nodes-base.httpRequest': [4, 4.1, 4.2, 4.3, 4.4],
  'n8n-nodes-base.googleSheets': [4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7],
  'n8n-nodes-base.telegram': [1, 1.1, 1.2],
  'n8n-nodes-base.executeWorkflow': [1, 1.1, 1.2, 1.3],
  'n8n-nodes-base.executeWorkflowTrigger': [1, 1.1, 1.2],
  'n8n-nodes-base.scheduleTrigger': [1, 1.1, 1.2, 1.3],
  'n8n-nodes-base.manualTrigger': [1],
  'n8n-nodes-base.errorTrigger': [1],
  'n8n-nodes-base.set': [3, 3.1, 3.2, 3.3, 3.4, 3.5],
  'n8n-nodes-base.splitInBatches': [3],
  'n8n-nodes-base.splitOut': [1],
  'n8n-nodes-base.noOp': [1],
  'n8n-nodes-base.stopAndError': [1],
  'n8n-nodes-base.form': [1, 2.3, 2.4, 2.5],
};

const HOJAS = ['config', 'listas', 'catalogo_temas', 'base_conocimiento', 'cuentas', 'conversaciones', 'escenarios', 'revision_humana', 'evaluaciones', 'detalle_criterios', 'log_errores', 'alertas', 'metricas'];

function todos() {
  const lista = Object.keys(ESPERADOS).map((f) => [f, leer(f)]);
  lista.push(['pruebas/mock_api.json', leer('pruebas/mock_api.json')]);
  return lista;
}

test('los 6 workflows existen con su nombre exacto y el error workflow asignado', () => {
  for (const [archivo, nombre] of Object.entries(ESPERADOS)) {
    const wf = leer(archivo);
    assert.equal(wf.name, nombre);
    assert.equal(wf.settings.executionOrder, 'v1');
    if (archivo === '99_errores.json') assert.equal(wf.settings.errorWorkflow, undefined, '99 Errores no se llama a sí mismo');
    else assert.equal(wf.settings.errorWorkflow, '<ID_WORKFLOW_ERRORES>', `${nombre} sin error workflow`);
  }
});

test('cada nodo usa un tipo y una versión del inventario; conexiones válidas', () => {
  for (const [archivo, wf] of todos()) {
    const nombres = new Set(wf.nodes.map((n) => n.name));
    assert.equal(nombres.size, wf.nodes.length, `${archivo}: nombres de nodo repetidos`);
    for (const n of wf.nodes) {
      assert.ok(VERSIONES[n.type], `${archivo}: tipo no inventariado ${n.type} (${n.name})`);
      assert.ok(VERSIONES[n.type].includes(n.typeVersion), `${archivo}: ${n.type} v${n.typeVersion} no existe en n8n 2.32.6 (${n.name})`);
    }
    for (const [de, c] of Object.entries(wf.connections)) {
      assert.ok(nombres.has(de), `${archivo}: conexión desde nodo inexistente ${de}`);
      for (const salida of c.main) for (const destino of salida) assert.ok(nombres.has(destino.node), `${archivo}: ${de} -> ${destino.node} no existe`);
    }
  }
});

test('Sheets: marcador de libro, hojas del contrato y operaciones de escritura con RAW + ignorar extras', () => {
  for (const [archivo, wf] of todos()) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) {
      assert.equal(n.parameters.documentId.value, '<ID_LIBRO_SHEETS>', `${archivo}: ${n.name}`);
      assert.ok(HOJAS.includes(n.parameters.sheetName.value), `${archivo}: hoja fuera del contrato en ${n.name}`);
      assert.equal(n.credentials.googleSheetsOAuth2Api.id, '<ASIGNAR_EN_N8N>');
      assert.equal(n.retryOnFail, true, `${archivo}: ${n.name} sin reintento`);
      if (n.parameters.operation === 'append' || n.parameters.operation === 'update') {
        assert.equal(n.parameters.options.cellFormat, 'RAW');
        assert.equal(n.parameters.options.handlingExtraData, 'ignoreIt');
        if (n.parameters.operation === 'update') assert.deepEqual(n.parameters.columns.matchingColumns, ['llave_dedup']);
      }
    }
  }
});

test('OpenAI y Claude: respuesta completa, nunca fallar y salida de error al clasificador', () => {
  const casos = [
    ['02_evaluacion.json', 'OpenAI: evaluar conversación', 'Clasificar respuesta OpenAI'],
    ['00_simulador.json', 'Claude: generar conversación', 'Clasificar respuesta Claude'],
  ];
  for (const [archivo, nodo, clasificador] of casos) {
    const wf = leer(archivo);
    const n = wf.nodes.find((x) => x.name === nodo);
    assert.deepEqual(n.parameters.options.response.response, { fullResponse: true, neverError: true, responseFormat: 'json' });
    assert.equal(n.parameters.options.timeout, '={{ $json.config.tiempo_maximo_peticion_llm_ms }}', 'timeout desde config');
    assert.equal(n.onError, 'continueErrorOutput');
    assert.equal(n.credentials.httpHeaderAuth.id, '<ASIGNAR_EN_N8N>');
    const salidas = wf.connections[nodo].main;
    assert.equal(salidas[0][0].node, clasificador);
    assert.equal(salidas[1][0].node, clasificador);
  }
  const claude = leer('00_simulador.json').nodes.find((x) => x.name === 'Claude: generar conversación');
  assert.deepEqual(claude.parameters.headerParameters.parameters, [{ name: 'anthropic-version', value: '={{ $json.config.anthropic_version_api }}' }]);
});

test('Telegram: reintento nativo y salida de error conectada al registro en alertas', () => {
  for (const [archivo, wf] of todos()) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.telegram')) {
      assert.equal(n.onError, 'continueErrorOutput', `${archivo}: ${n.name}`);
      assert.equal(n.retryOnFail, true);
      assert.equal(n.parameters.additionalFields.appendAttribution, false);
      const [ok, error] = wf.connections[n.name].main;
      assert.equal(ok[0].node, error[0].node, `${archivo}: ${n.name} debe mandar ambas salidas al registro`);
    }
  }
});

test('Telegram: envía texto_html con parse_mode HTML (sin Markdown por defecto)', () => {
  let total = 0;
  for (const [archivo, wf] of todos()) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.telegram')) {
      total += 1;
      assert.equal(n.parameters.text, '={{ $json.texto_html }}', `${archivo}: ${n.name} debe enviar texto_html`);
      assert.equal(n.parameters.additionalFields.parse_mode, 'HTML', `${archivo}: ${n.name} sin parse_mode HTML`);
    }
  }
  assert.ok(total > 0);
});

/** Nodos alcanzables desde las salidas indicadas de `nombre` (sin pasar dos veces por el mismo). */
function alcanzables(wf, nombre, salidas) {
  const vistos = new Set();
  const pendientes = salidas.flatMap((s) => ((wf.connections[nombre] || { main: [] }).main[s] || []).map((d) => d.node));
  while (pendientes.length) {
    const n = pendientes.pop();
    if (vistos.has(n)) continue;
    vistos.add(n);
    for (const destinos of (wf.connections[n] || { main: [] }).main) for (const d of destinos || []) pendientes.push(d.node);
  }
  return vistos;
}

const escribeEn = (wf, nodo, hoja) => {
  const n = wf.nodes.find((x) => x.name === nodo);
  return n && n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation === 'append' && n.parameters.sheetName.value === hoja;
};

test('Telegram: cada salida (normal y de error) llega a una escritura en la hoja alertas', () => {
  for (const [archivo, wf] of todos()) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.telegram')) {
      const salidas = wf.connections[n.name].main;
      assert.equal(salidas.length, 2, `${archivo}: ${n.name} debe tener salida normal y de error conectadas`);
      for (const s of [0, 1]) {
        assert.ok(salidas[s].length > 0, `${archivo}: ${n.name} salida ${s} sin conectar`);
        const destino = [...alcanzables(wf, n.name, [s])];
        assert.ok(destino.some((d) => escribeEn(wf, d, 'alertas')), `${archivo}: ${n.name} salida ${s} no termina en la hoja alertas`);
        if (n.name === 'Telegram: alerta operativa') {
          assert.ok(destino.some((d) => escribeEn(wf, d, 'log_errores')), `${archivo}: salida ${s} no llega a log_errores`);
        }
      }
    }
  }
});

test('Cadena de errores: log_errores se escribe después del Telegram o por la rama "no alertar"', () => {
  for (const archivo of ['00_simulador.json', '01_ingesta.json', '02_evaluacion.json', '04_reproceso.json', '99_errores.json']) {
    const wf = leer(archivo);
    const origenes = Object.entries(wf.connections).flatMap(([de, c]) => c.main.flatMap((ds, s) => ds.filter((d) => d.node === 'Escribir log_errores').map(() => `${de}#${s}`)));
    assert.deepEqual(origenes.sort(), ['Fila log_errores (sin alerta)#0', 'Fila log_errores (tras el envío)#0'], archivo);
    // "Fila log_errores (tras el envío)" solo se alcanza pasando por el Telegram.
    const desdeIf = alcanzables(wf, '¿Enviar alerta operativa?', [0]);
    assert.ok(desdeIf.has('Telegram: alerta operativa') && desdeIf.has('Fila log_errores (tras el envío)'), archivo);
    assert.ok(alcanzables(wf, 'Telegram: alerta operativa', [0, 1]).has('Fila log_errores (tras el envío)'), archivo);
    assert.deepEqual(wf.connections['¿Enviar alerta operativa?'].main[1].map((d) => d.node), ['Fila log_errores (sin alerta)'], archivo);
    // La rama "no" va directo a la escritura (en W0 después sigue el bucle, por eso no se usa alcanzables).
    assert.deepEqual(wf.connections['Fila log_errores (sin alerta)'].main.map((s) => s.map((d) => d.node)), [['Escribir log_errores']], archivo);
  }
});

test('Code por ítem: ningún nodo contiene $input.first/last/all/itemMatching (n8n los rechaza)', () => {
  const re = /\$input\.(first|last|all|itemMatching)/;
  const fallas = [];
  let porItem = 0;
  for (const [archivo, wf] of todos()) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code' && x.parameters.mode === 'runOnceForEachItem')) {
      porItem += 1;
      const m = n.parameters.jsCode.match(re);
      if (m) fallas.push(`${archivo}: "${n.name}" contiene ${m[0]}`);
    }
  }
  assert.ok(porItem > 0);
  assert.deepEqual(fallas, []);
  // $('Nodo').all() sí está permitido y no se marca.
  assert.equal(re.test("$('Leer hoja config').all()"), false);
});

test('W2: el Switch de validación cubre las 6 acciones de procesarRespuestaEvaluador', () => {
  const wf = leer('02_evaluacion.json');
  const sw = wf.nodes.find((x) => x.name === 'Según validación');
  assert.deepEqual(
    sw.parameters.rules.values.map((r) => r.outputKey),
    ['falla_api', 'rechazo_llm', 'reintentar_incompleta', 'respuesta_llm_invalida', 'reintentar_validacion', 'continuar']
  );
  const destinos = wf.connections['Según validación'].main.map((s) => s.map((d) => d.node));
  assert.deepEqual(destinos, [
    ['Error del evaluador: a reproceso'],
    ['Error del evaluador: a error'],
    ['Reintento por respuesta incompleta'],
    ['Error del evaluador: a error'],
    ['Preparar reintento OpenAI'],
    ['JS-6 Reglas híbridas'],
  ]);
});

test('cada expresión ={{ ... }} de los parámetros es JavaScript válido', () => {
  const recorrer = (x, ruta, fallas) => {
    if (typeof x === 'string') {
      const m = /^=\{\{([\s\S]*)\}\}$/.exec(x);
      if (m) {
        try {
          new Function('$', '$json', `return (${m[1]});`);
        } catch (e) {
          fallas.push(`${ruta}: ${e.message}`);
        }
      }
    } else if (x && typeof x === 'object') {
      for (const [k, v] of Object.entries(x)) recorrer(v, `${ruta}.${k}`, fallas);
    }
  };
  const fallas = [];
  for (const [archivo, wf] of todos()) for (const n of wf.nodes) if (n.type !== 'n8n-nodes-base.code') recorrer(n.parameters, `${archivo} "${n.name}"`, fallas);
  assert.deepEqual(fallas, []);
});

test('W1: el disparador manual de calibración viene desactivado y con lote vacío (decisión del dueño)', () => {
  const wf = leer('01_ingesta.json');
  assert.equal(wf.nodes.find((n) => n.name === 'Disparador manual de calibración').disabled, true);
  const par = wf.nodes.find((n) => n.name === 'Parámetros de calibración').parameters.assignments.assignments;
  assert.equal(par.find((a) => a.name === 'lote').value, '');
  assert.equal(wf.settings.saveDataErrorExecution, 'all', 'W1 guarda las ejecuciones fallidas para recuperar payloads');
});

test('W3 es esqueleto: "Escribir metricas" no recibe datos de ningún nodo', () => {
  const wf = leer('03_metricas.json');
  assert.ok(wf.nodes.some((n) => n.name === 'Escribir metricas'));
  const destinos = Object.values(wf.connections).flatMap((c) => c.main.flat().map((d) => d.node));
  assert.ok(!destinos.includes('Escribir metricas'));
});

test('IMPORTAR.md: los totales de nodos con credencial coinciden con los JSON', () => {
  const texto = fs.readFileSync(path.join(DIR, 'IMPORTAR.md'), 'utf8');
  const prefijos = ['Leer', 'Escribir', 'Insertar', 'Actualizar', 'Reactivar', 'Crear filas', 'Pasar'];
  for (const [etiqueta, tipo] of [['Sheets', 'n8n-nodes-base.googleSheets'], ['Telegram', 'n8n-nodes-base.telegram']]) {
    const inicio = texto.indexOf(`Total por workflow (${etiqueta}): `);
    const m = inicio === -1 ? null : [null, texto.slice(inicio, texto.indexOf('|', inicio))];
    assert.ok(m, `falta la línea de totales de ${etiqueta}`);
    const declarados = Object.fromEntries([...m[1].matchAll(/(\d+) en (\d{2})/g)].map((x) => [x[2], Number(x[1])]));
    for (const archivo of Object.keys(ESPERADOS)) {
      const nodos = leer(archivo).nodes.filter((n) => n.type === tipo);
      assert.equal(declarados[archivo.slice(0, 2)], nodos.length, `${etiqueta} en ${archivo}`);
      if (tipo === 'n8n-nodes-base.googleSheets') for (const n of nodos) assert.ok(prefijos.some((p) => n.name.startsWith(p)), `prefijo no listado: ${n.name}`);
      else for (const n of nodos) assert.ok(n.name.startsWith('Telegram: '), n.name);
    }
  }
});

test('las plantillas y pruebas/ son las que escribe construir_plantillas.mjs', async () => {
  const { construirTodo, serializarPlantilla } = await import(pathToFileURL(path.join(DIR, 'herramientas', 'construir_plantillas.mjs')).href);
  for (const [rel, obj] of Object.entries(construirTodo())) {
    const actual = fs.readFileSync(path.join(DIR, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(actual === serializarPlantilla(obj), true, `workflows/${rel} no está al día: corre node workflows/herramientas/construir_plantillas.mjs`);
  }
});
