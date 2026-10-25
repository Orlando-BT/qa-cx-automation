// =============================================================================
// sincronia.test.js — los nodos Code y Set de los workflows deben ser una copia exacta
// de js/, workflows/pegamento/, prompts/ y contrato/.
// -----------------------------------------------------------------------------
// Qué protege:
//   - Si alguien edita un nodo en la UI de n8n y exporta el workflow, la prueba falla y
//     dice qué nodo y qué archivo difieren: el cambio se hace en js/ (o en el prompt),
//     nunca en el JSON.
//   - Si cambia js/ y no se reensambla, también falla.
//   - Un nodo Code sin marcadores FUENTE/PEGAMENTO, o un pegamento de más de 15 líneas
//     efectivas, falla: la lógica de decisión vive en js/, no en workflows/.
//   - Los textos de prompts en nodos Set no pueden contener "{{" ni "${" (n8n los
//     interpretaría).
// Corre con: node --test js/tests/*.test.js workflows/tests/*.test.js
// =============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RAIZ = path.resolve(__dirname, '..', '..');
const DIR_WF = path.join(RAIZ, 'workflows');
const FIXTURE = path.join(__dirname, 'fixtures', 'plantillas', 'prueba_ensamblado.json');

let modulo;
async function ens() {
  if (!modulo) modulo = await import(pathToFileURL(path.join(DIR_WF, 'herramientas', 'ensamblar.mjs')).href);
  return modulo;
}
const leerJson = (ruta) => JSON.parse(fs.readFileSync(ruta, 'utf8'));
const nodo = (wf, nombre) => wf.nodes.find((n) => n.name === nombre);

/** Workflows generados en workflows/ (los *.json de la raíz de la carpeta). */
function workflowsGenerados() {
  return fs
    .readdirSync(DIR_WF)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(DIR_WF, f));
}

// --- workflows reales ------------------------------------------------------------

test('cada workflow generado coincide exactamente con su recálculo desde el repo', async (t) => {
  const { diferenciasMarcadas, revisarWorkflow } = await ens();
  const archivos = workflowsGenerados();
  if (archivos.length === 0) {
    t.diagnostic('Aún no hay workflows generados en workflows/ (parte 2). Solo corren las pruebas con fixtures.');
    return;
  }
  for (const archivo of archivos) {
    const wf = leerJson(archivo);
    const difs = diferenciasMarcadas(wf);
    assert.deepEqual(
      difs.map((d) => `${path.basename(archivo)}: nodo "${d.nodo}" difiere de ${d.archivo}`),
      [],
      'Reensambla con node workflows/herramientas/ensamblar.mjs y no edites nodos Code/Set en n8n'
    );
    assert.deepEqual(revisarWorkflow(wf), [], `${path.basename(archivo)} incumple las reglas de workflows/`);
  }
});

test('cada plantilla tiene su workflow generado y está al día (equivale a --verificar)', async (t) => {
  const { listarPlantillas, ensamblarWorkflow, serializar } = await ens();
  const plantillas = listarPlantillas();
  if (plantillas.length === 0) {
    t.diagnostic('Aún no hay plantillas en workflows/plantillas/ (parte 2).');
    return;
  }
  for (const p of plantillas) {
    const destino = path.join(DIR_WF, p.nombre);
    assert.ok(fs.existsSync(destino), `falta workflows/${p.nombre}: corre el ensamblador`);
    const esperado = serializar(ensamblarWorkflow(leerJson(p.ruta)));
    const actual = fs.readFileSync(destino, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(actual === esperado, true, `workflows/${p.nombre} no está al día con su plantilla`);
  }
});

// --- ensamblado con la plantilla de prueba -------------------------------------------

test('fixture: el ensamblado cumple las reglas, conserva marcadores y es idempotente', async () => {
  const { ensamblarWorkflow, revisarWorkflow, diferenciasMarcadas, leerMarcadoresCode } = await ens();
  const generado = ensamblarWorkflow(leerJson(FIXTURE));
  assert.deepEqual(revisarWorkflow(generado), []);
  assert.deepEqual(diferenciasMarcadas(generado), []);
  assert.deepEqual(ensamblarWorkflow(generado), generado, 'ensamblar dos veces debe dar lo mismo');

  const js3 = nodo(generado, 'JS-3 Reglas deterministas').parameters.jsCode;
  assert.match(js3.split('\n')[0], /^\/\/ GENERADO, no editar en n8n; fuente: js\/reglas\.js \+ workflows\/pegamento\/js3_reglas_deterministas\.js$/);
  assert.deepEqual(leerMarcadoresCode(js3), { fuentes: ['js/reglas.js'], pegamentos: ['pegamento/js3_reglas_deterministas.js'] });
  const reglas = fs.readFileSync(path.join(RAIZ, 'js', 'reglas.js'), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  assert.ok(js3.includes(reglas), 'el archivo de js/ debe ir completo y literal');

  const varias = nodo(generado, 'Config cargada').parameters.jsCode;
  assert.ok(varias.indexOf('INICIO js/normalizacion.js') < varias.indexOf('INICIO js/costo.js'), 'las FUENTE se respetan en orden');
});

test('fixture: los nodos Set quedan con el texto exacto de prompts/ y contrato/, sin {{ ni ${', async () => {
  const { ensamblarWorkflow } = await ens();
  const generado = ensamblarWorkflow(leerJson(FIXTURE));
  const casos = [
    ['Plantilla evaluador', 'plantilla_evaluador', 'prompts/evaluador_ce_v1.md'],
    ['Esquema LLM', 'esquema_llm', 'contrato/llm_output.schema.json'],
    ['Plantilla y esquema generador', 'plantilla_generador', 'prompts/generador_ce_v1.md'],
    ['Plantilla y esquema generador', 'esquema_generador', 'prompts/generador_payload_salida.schema.json'],
  ];
  for (const [nombre, campo, ruta] of casos) {
    const a = nodo(generado, nombre).parameters.assignments.assignments.find((x) => x.name === campo);
    const esperado = fs.readFileSync(path.join(RAIZ, ...ruta.split('/')), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '') + '\n';
    assert.equal(a.value, esperado, `${nombre}.${campo} debe ser copia de ${ruta}`);
    assert.ok(!a.value.includes('{{') && !a.value.includes('${'), `${ruta} contiene {{ o \${`);
    assert.ok(!a.value.startsWith('='), `${ruta} empieza con "="`);
    if (a.type === 'object') JSON.parse(a.value);
  }
});

test('fixture: un nodo editado en n8n se detecta con nodo y archivo', async () => {
  const { ensamblarWorkflow, diferenciasMarcadas } = await ens();
  const generado = ensamblarWorkflow(leerJson(FIXTURE));

  const enPegamento = JSON.parse(JSON.stringify(generado));
  const n1 = nodo(enPegamento, 'JS-3 Reglas deterministas');
  const codigo1 = n1.parameters.jsCode;
  const i1 = codigo1.lastIndexOf('evaluarReglasJS(contexto);'); // la del pegamento (la primera está en un comentario de js/reglas.js)
  n1.parameters.jsCode = codigo1.slice(0, i1) + '{};' + codigo1.slice(i1 + 'evaluarReglasJS(contexto);'.length);
  assert.deepEqual(diferenciasMarcadas(enPegamento), [{ nodo: 'JS-3 Reglas deterministas', archivo: 'workflows/pegamento/js3_reglas_deterministas.js' }]);

  const enFuente = JSON.parse(JSON.stringify(generado));
  const n2 = nodo(enFuente, 'Clasificar respuesta OpenAI');
  n2.parameters.jsCode = n2.parameters.jsCode.replace('codigo === 429', 'codigo === 430');
  assert.deepEqual(diferenciasMarcadas(enFuente), [{ nodo: 'Clasificar respuesta OpenAI', archivo: 'js/clasificacion_http.js' }]);

  const enSet = JSON.parse(JSON.stringify(generado));
  nodo(enSet, 'Plantilla evaluador').parameters.assignments.assignments[0].value += 'texto agregado en n8n';
  assert.deepEqual(diferenciasMarcadas(enSet), [{ nodo: 'Plantilla evaluador', archivo: 'prompts/evaluador_ce_v1.md' }]);
});

// --- reglas de la carpeta -------------------------------------------------------------

test('un nodo Code sin marcadores FUENTE/PEGAMENTO no se permite', async () => {
  const { revisarWorkflow } = await ens();
  const wf = { nodes: [{ name: 'Lógica suelta', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return $input.all();' } }] };
  const problemas = revisarWorkflow(wf);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /sin marcadores FUENTE\/PEGAMENTO/);
  const soloFuente = { nodes: [{ name: 'Sin pegamento', type: 'n8n-nodes-base.code', parameters: { jsCode: '// FUENTE: js/reglas.js\nreturn [];' } }] };
  assert.match(revisarWorkflow(soloFuente)[0], /sin marcadores FUENTE\/PEGAMENTO/);
});

test('un pegamento de más de 15 líneas efectivas no se permite', async () => {
  const { revisarWorkflow, contarLineasEfectivas, LIMITE_LINEAS_PEGAMENTO } = await ens();
  assert.equal(LIMITE_LINEAS_PEGAMENTO, 15);
  assert.equal(contarLineasEfectivas('// comentario\n\n/* bloque\n de comentario */\nconst a = 1;\n  // otro\nreturn a;\n'), 2);

  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pegamento-'));
  fs.mkdirSync(path.join(raiz, 'workflows', 'pegamento'), { recursive: true });
  const largo = Array.from({ length: 16 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\nreturn { json: {} };\n';
  fs.writeFileSync(path.join(raiz, 'workflows', 'pegamento', 'largo.js'), largo);
  const wf = {
    nodes: [{ name: 'Demasiada lógica', type: 'n8n-nodes-base.code', parameters: { jsCode: '// FUENTE: js/reglas.js\n// PEGAMENTO: pegamento/largo.js\nreturn [];' } }],
  };
  const problemas = revisarWorkflow(wf, { raiz });
  fs.rmSync(raiz, { recursive: true, force: true });
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /17 líneas efectivas \(máximo 15\)/);
});

test('prompts en Set con {{, ${ o "=" inicial y credenciales sin marcador se reportan', async () => {
  const { revisarWorkflow } = await ens();
  const setCon = (valor) => ({
    name: 'Plantilla evaluador',
    type: 'n8n-nodes-base.set',
    notes: 'RELLENO plantilla_evaluador <- prompts/evaluador_ce_v1.md',
    parameters: { assignments: { assignments: [{ name: 'plantilla_evaluador', type: 'string', value: valor }] } },
  });
  assert.match(revisarWorkflow({ nodes: [setCon('hola {{ $json.x }}')] })[0], /contiene "\{\{"/);
  assert.match(revisarWorkflow({ nodes: [setCon('hola ${x}')] })[0], /contiene "\$\{"/);
  assert.match(revisarWorkflow({ nodes: [setCon('=hola')] })[0], /empieza con "="/);
  const conCred = { nodes: [{ name: 'OpenAI', type: 'n8n-nodes-base.httpRequest', parameters: {}, credentials: { httpHeaderAuth: { id: 'abc123', name: 'x' } } }] };
  assert.match(revisarWorkflow(conCred)[0], /no usa el marcador <ASIGNAR_EN_N8N>/);
});

test('dos FUENTE que exportan el mismo nombre: se acepta la misma copia y se rechaza si difiere', async () => {
  const { generarCodigo } = await ens();
  // marcaTiempoSistema está copiada a propósito (mismo código) en costo.js y simulador.js.
  const codigo = generarCodigo({ fuentes: ['js/simulador.js', 'js/costo.js'], pegamento: 'pegamento/js3_reglas_deterministas.js' });
  assert.equal((codigo.match(/const {[^}]*marcaTiempoSistema/g) || []).length, 1, 'el nombre se desestructura una sola vez');
  // limpiarTexto tiene contenido distinto en registro_errores.js y alertas.js.
  assert.throws(
    () => generarCodigo({ fuentes: ['js/registro_errores.js', 'js/alertas.js'], pegamento: 'pegamento/js3_reglas_deterministas.js' }),
    /exportan el mismo nombre "limpiarTexto" con distinto contenido/
  );
});

// --- el código generado funciona como en n8n -------------------------------------------

test('el nodo generado se ejecuta con $, $json como en n8n (Clasificar respuesta OpenAI)', async () => {
  const { ensamblarWorkflow } = await ens();
  const generado = ensamblarWorkflow(leerJson(FIXTURE));
  const codigo = nodo(generado, 'Clasificar respuesta OpenAI').parameters.jsCode;
  const FuncionAsincrona = Object.getPrototypeOf(async function () {}).constructor;
  const ejecutar = new FuncionAsincrona('$', '$json', codigo);
  const config = { reintentos_conexion_api: 3, espera_entre_reintentos_ms: 5000, espera_maxima_reintento_ms: 60000 };
  const contexto = { config, intento_conexion: 0, conversation_id: 'CONV-0001' };
  const $ = (nombre) => {
    assert.equal(nombre, 'Preparar llamada OpenAI');
    return { item: { json: contexto } };
  };
  const r503 = await ejecutar($, { statusCode: 503, headers: {}, body: {} });
  assert.equal(r503.json.clasificacion_http.accion, 'reintentar');
  assert.equal(r503.json.clasificacion_http.espera_ms, 5000);
  assert.equal(r503.json.conversation_id, 'CONV-0001');
  const r401 = await ejecutar($, { statusCode: 401, headers: {}, body: {} });
  assert.equal(r401.json.clasificacion_http.accion, 'falla_api');
  const r200 = await ejecutar($, { statusCode: 200, headers: {}, body: {} });
  assert.equal(r200.json.clasificacion_http.accion, 'continuar');
});

// --- valores locales --------------------------------------------------------------

test('--local sustituye marcadores y credenciales solo en la copia, nunca en nodos Code', async () => {
  const { ensamblarWorkflow, aplicarValoresLocales } = await ens();
  const generado = ensamblarWorkflow(leerJson(FIXTURE));
  const antes = JSON.stringify(generado);
  const { workflow, sinValor } = aplicarValoresLocales(generado, {
    marcadores: { '<ID_LIBRO_SHEETS>': 'LIBRO-DE-PRUEBA', '<URL_WEBHOOK_INGESTA>': 'http://localhost:5678/webhook/prueba' },
    credenciales: { 'OpenAI (Authorization Bearer)': 'cred-prueba-1' },
  });
  assert.equal(JSON.stringify(generado), antes, 'el workflow original no cambia');
  assert.equal(nodo(workflow, 'Leer hoja config').parameters.documentId.value, 'LIBRO-DE-PRUEBA');
  assert.equal(nodo(workflow, 'HTTP de prueba').parameters.url, 'http://localhost:5678/webhook/prueba');
  assert.equal(nodo(workflow, 'HTTP de prueba').credentials.httpHeaderAuth.id, 'cred-prueba-1');
  assert.equal(nodo(workflow, 'JS-3 Reglas deterministas').parameters.jsCode, nodo(generado, 'JS-3 Reglas deterministas').parameters.jsCode);
  assert.ok(sinValor.includes('<ID_WORKFLOW_ERRORES>'));
  assert.ok(sinValor.includes('credencial "Google Sheets QA"'));
});

test('informe: pegamentos que exceden el límite (pendientes de una función en js/)', async (t) => {
  const { contarLineasEfectivas, LIMITE_LINEAS_PEGAMENTO } = await ens();
  const dir = path.join(DIR_WF, 'pegamento');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const n = contarLineasEfectivas(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (n > LIMITE_LINEAS_PEGAMENTO) t.diagnostic(`pegamento/${f}: ${n} líneas efectivas; no puede usarse en un workflow hasta reducirlo`);
  }
});
