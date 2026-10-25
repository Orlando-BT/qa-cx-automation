// =============================================================================
// secretos.test.js — ningún archivo de workflows/ (salvo _local/) lleva claves, tokens,
// IDs de credencial reales, IDs de libro de Google ni chat IDs de Telegram.
// -----------------------------------------------------------------------------
// Al fallar reporta SOLO "encontrado en <archivo>:<línea>, patrón <nombre>". Nunca imprime
// el valor encontrado, para que el propio reporte no filtre el secreto.
// Las pruebas de los detectores arman valores falsos en tiempo de ejecución (por partes)
// y en una carpeta temporal, para que en el repo no exista ningún texto con forma de clave.
// =============================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const DIR_WF = path.join(RAIZ, 'workflows');
const MARCADOR_CREDENCIAL = '<ASIGNAR_EN_N8N>';
const MARCADOR_LIBRO = '<ID_LIBRO_SHEETS>';
const EXTENSIONES = new Set(['.json', '.js', '.mjs', '.cjs', '.md', '.txt', '.csv', '.env', '.yml', '.yaml']);

// Patrones por línea. Cada uno tiene nombre; el valor nunca se muestra.
const PATRONES = [
  { nombre: 'clave_anthropic', re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { nombre: 'clave_openai', re: /\bsk-(?!ant-)[A-Za-z0-9_-]{16,}/ },
  { nombre: 'token_bot_telegram', re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/ },
  { nombre: 'bearer_con_valor', re: /Bearer\s+(?![<{$])[A-Za-z0-9._~+/=-]{12,}/i },
  { nombre: 'x_api_key_con_valor', re: /x-api-key["']?\s*[:=]\s*["'](?![<{=])[^"'\s]{12,}/i },
  { nombre: 'url_libro_google', re: /docs\.google\.com\/spreadsheets\/d\/(?!<)[A-Za-z0-9_-]{20,}/ },
  // Un ID de libro de Google tiene ~44 caracteres con mayúsculas, minúsculas y dígitos mezclados.
  { nombre: 'id_libro_google', re: /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]{40,50}(?![A-Za-z0-9_-]))(?=[^\s"']*[A-Z])(?=[^\s"']*[a-z])(?=[^\s"']*[0-9])[A-Za-z0-9_-]{40,50}/ },
  { nombre: 'chat_id_telegram', re: /"?chat_?id"?\s*[:=]\s*"?-?\d{5,}/i },
  { nombre: 'chat_id_grupo_telegram', re: /(?<![0-9])-100\d{8,}(?![0-9])/ },
];

/** Archivos a revisar: todo workflows/ excepto _local/ y node_modules/. */
function archivosARevisar(dir) {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === '_local' || entrada.name === 'node_modules') continue;
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosARevisar(ruta));
    else if (EXTENSIONES.has(path.extname(entrada.name).toLowerCase())) salida.push(ruta);
  }
  return salida;
}

function lineaDe(texto, indice) {
  return texto.slice(0, indice).split('\n').length;
}

/** Hallazgos estructurales en JSON de workflows: credenciales y documentId de Sheets. */
function hallazgosEstructurales(texto, rel) {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (_) {
    return [];
  }
  const hallazgos = [];
  const nodos = Array.isArray(datos.nodes) ? datos.nodes : [];
  for (const n of nodos) {
    for (const cred of Object.values(n.credentials || {})) {
      const id = cred && cred.id;
      if (id !== MARCADOR_CREDENCIAL) {
        const i = typeof id === 'string' && id !== '' ? texto.indexOf(JSON.stringify(id)) : texto.indexOf('"credentials"');
        hallazgos.push({ archivo: rel, linea: lineaDe(texto, Math.max(0, i)), patron: 'id_credencial_sin_marcador' });
      }
    }
    if (n.type === 'n8n-nodes-base.googleSheets') {
      const doc = n.parameters && n.parameters.documentId;
      const valor = doc && typeof doc === 'object' ? doc.value : doc;
      if (valor !== undefined && valor !== MARCADOR_LIBRO) {
        const i = typeof valor === 'string' && valor !== '' ? texto.indexOf(JSON.stringify(valor)) : texto.indexOf('"documentId"');
        hallazgos.push({ archivo: rel, linea: lineaDe(texto, Math.max(0, i)), patron: 'id_libro_sin_marcador' });
      }
    }
    if (n.type === 'n8n-nodes-base.telegram') {
      const chat = n.parameters && n.parameters.chatId;
      if (typeof chat === 'string' && /-?\d{5,}/.test(chat)) {
        hallazgos.push({ archivo: rel, linea: lineaDe(texto, Math.max(0, texto.indexOf('"chatId"'))), patron: 'chat_id_fijo_en_nodo' });
      }
    }
  }
  return hallazgos;
}

/** Revisa una carpeta y devuelve [{ archivo, linea, patron }] sin valores. */
function buscarSecretos(dir) {
  const hallazgos = [];
  for (const ruta of archivosARevisar(dir)) {
    const rel = path.relative(RAIZ, ruta).split(path.sep).join('/');
    const texto = fs.readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n');
    texto.split('\n').forEach((linea, i) => {
      for (const p of PATRONES) if (p.re.test(linea)) hallazgos.push({ archivo: rel, linea: i + 1, patron: p.nombre });
    });
    if (ruta.endsWith('.json')) hallazgos.push(...hallazgosEstructurales(texto, rel));
  }
  return hallazgos;
}

const formato = (h) => `encontrado en ${h.archivo}:${h.linea}, patrón ${h.patron}`;

test('workflows/ (sin _local/) no contiene secretos ni IDs reales', () => {
  const hallazgos = buscarSecretos(DIR_WF);
  // El mensaje solo lleva archivo, línea y nombre del patrón.
  assert.equal(hallazgos.length, 0, '\n' + hallazgos.map(formato).join('\n'));
});

test('los detectores encuentran cada patrón y no muestran el valor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretos-'));
  const falso = (n) => Array.from({ length: n }, (_, i) => 'aB3'[i % 3]).join('');
  const lineas = [
    'clave: "' + 'sk' + '-' + 'ant-' + falso(24) + '"',
    'clave: "' + 'sk' + '-' + 'proj' + falso(24) + '"',
    'token: "' + '1234567' + '89:' + falso(35) + '"',
    'Authorization: Bear' + 'er ' + falso(20),
    '"x-api-key": "' + falso(20) + '"',
    'https://docs.google.com/spreadsheets' + '/d/' + falso(44) + '/edit',
    'id: ' + falso(44),
    '"chat_id": ' + '98765' + '4321',
    'grupo: -100' + '1234567890',
  ];
  fs.writeFileSync(path.join(dir, 'muestra.md'), lineas.join('\n'));
  const wf = {
    nodes: [
      { name: 'A', type: 'n8n-nodes-base.httpRequest', parameters: {}, credentials: { httpHeaderAuth: { id: 'Xy12' + 'abc', name: 'OpenAI' } } },
      { name: 'B', type: 'n8n-nodes-base.googleSheets', parameters: { documentId: { __rl: true, value: 'libro-real', mode: 'id' } } },
      { name: 'C', type: 'n8n-nodes-base.telegram', parameters: { chatId: '12345' + '678' } },
    ],
  };
  fs.writeFileSync(path.join(dir, 'wf.json'), JSON.stringify(wf, null, 2));
  const hallazgos = buscarSecretos(dir).map((h) => ({ ...h, archivo: path.basename(h.archivo) }));
  fs.rmSync(dir, { recursive: true, force: true });

  const nombres = new Set(hallazgos.map((h) => h.patron));
  for (const p of PATRONES) assert.ok(nombres.has(p.nombre), `el patrón ${p.nombre} no detectó su muestra`);
  for (const n of ['id_credencial_sin_marcador', 'id_libro_sin_marcador', 'chat_id_fijo_en_nodo']) assert.ok(nombres.has(n), n);
  // El reporte nunca contiene el valor: solo archivo, línea y patrón.
  for (const h of hallazgos) {
    assert.deepEqual(Object.keys(h).sort(), ['archivo', 'linea', 'patron']);
    assert.ok(!formato(h).includes(falso(20)));
  }
});

test('los marcadores y nombres del proyecto no disparan falsos positivos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secretos-ok-'));
  const wf = {
    nodes: [
      {
        name: 'OpenAI: evaluar conversación',
        type: 'n8n-nodes-base.httpRequest',
        parameters: { url: '<URL_WEBHOOK_INGESTA>', headerParameters: { parameters: [{ name: 'x-api-key', value: '={{ $json.x }}' }] } },
        credentials: { httpHeaderAuth: { id: MARCADOR_CREDENCIAL, name: 'OpenAI (Authorization Bearer)' } },
      },
      { name: 'Leer hoja config', type: 'n8n-nodes-base.googleSheets', parameters: { documentId: { __rl: true, value: MARCADOR_LIBRO, mode: 'id' } } },
      { name: 'Telegram', type: 'n8n-nodes-base.telegram', parameters: { chatId: '={{ $json.config.telegram_destinatario }}' } },
    ],
  };
  fs.writeFileSync(path.join(dir, 'wf.json'), JSON.stringify(wf, null, 2));
  fs.writeFileSync(
    path.join(dir, 'texto.md'),
    'precio_entrada_usd_millon_evaluador claves_esquema_excluidas_evaluador 6f0f6a3e-0000-4000-8000-000000000001 Bearer <ASIGNAR_EN_N8N> 5550001000\n'
  );
  const hallazgos = buscarSecretos(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(hallazgos.length, 0, hallazgos.map(formato).join('\n'));
});
