// =============================================================================
// verificar_openai.mjs
// -----------------------------------------------------------------------------
// Verificación técnica de Fase 1 (pendientes 1 y 3 de docs/registro-tecnico.md,
// sección 5, y config.md sección 13):
//   - ¿Acepta OpenAI, en salida estructurada estricta, el esquema
//     contrato/llm_output.schema.json tal cual ($schema, title, minItems y
//     minimum dentro de un tipo ["integer","null"])?
//   - ¿Acepta el modelo evaluador el parámetro temperature = 0? Si no, ¿qué
//     valor de reasoning.effort acepta?
//
// Prueba B (--prueba-b): costo y validez de UNA evaluación real con el prompt
// prompts/evaluador_ce_v1.md, armada con JS-2 (js/enmascaramiento.js, de
// reglas-js) y JS-4 (js/construccion_prompt.js), y revisada con JS-5
// (js/validador_llm.js). Usa SOLO contrato/ejemplos/payload_ejemplo.json; nunca
// datos/lotes/ (salvo el modo lote, sección 12b, que solo reporta agregados).
//
// Qué NO hace: no juzga si la evaluación del modelo es correcta (eso lo miden
// las métricas de calibración con la calificación humana).
//
// Ejecución (desde la raíz del repositorio, Node 24, sin dependencias):
//   node --env-file=.env prompts/verificacion/verificar_openai.mjs
//   node --env-file=.env prompts/verificacion/verificar_openai.mjs --modelo otro-modelo
//   node --env-file=.env prompts/verificacion/verificar_openai.mjs --prueba-b
//   node --env-file=.env prompts/verificacion/verificar_openai.mjs --prueba-b --esfuerzo none --quitar-claves '$schema,title'
//   node prompts/verificacion/verificar_openai.mjs --prueba-b --sin-llamada   (arma y mide el prompt sin llamar a la API)
//   node --env-file=.env prompts/verificacion/verificar_openai.mjs --prueba-b --lote calibracion_v1 --n 2 --tope-usd 0.05
//   node prompts/verificacion/verificar_openai.mjs --prueba-b --lote calibracion_v1 --n 2 --sin-llamada   (LLM simulado, sin API)
//
// Modo lote (--lote, sección 12b): evalúa N conversaciones de datos/lotes/<lote>/
// con el pipeline real JS-1..JS-8 y compara contra el escenario. Salida SOLO
// AGREGADA (regla del dueño: la calificación humana es a ciegas): nunca imprime
// ni guarda resultados por conversación.
//
// Seguridad: la clave se lee de process.env y SOLO se usa en el encabezado
// Authorization. Nunca se imprime ni se escribe en archivos. Tampoco se guarda
// la respuesta completa del modelo: solo métricas observadas (código HTTP,
// mensaje de error literal, tokens y si la salida parsea como JSON).
// =============================================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// -----------------------------------------------------------------------------
// 1. Rutas. Se calculan a partir de la ubicación de este archivo, así el script
//    funciona aunque se ejecute desde otra carpeta.
// -----------------------------------------------------------------------------
const CARPETA_SCRIPT = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = path.resolve(CARPETA_SCRIPT, '..', '..');
const RUTA_ESQUEMA = path.join(RAIZ_REPO, 'contrato', 'llm_output.schema.json');
const RUTA_RESULTADOS = path.join(CARPETA_SCRIPT, 'resultados_prueba_a.json');

// -----------------------------------------------------------------------------
// 2. Constantes de la prueba.
//    Precios verificados por el orquestador el 22-oct-2026 en
//    developers.openai.com para gpt-6-luna (USD por millón de tokens).
//    Si se usa otro modelo con --modelo, el costo mostrado NO es válido
//    (se avisa en consola).
// -----------------------------------------------------------------------------
const URL_API = 'https://api.openai.com/v1/responses';
const MODELO_DEFAULT = 'gpt-6-luna';
const PRECIO_ENTRADA_USD_MILLON = 0.10;
const PRECIO_SALIDA_USD_MILLON = 0.50;
const MAX_OUTPUT_TOKENS = 8000;     // tope de seguridad de costo por intento
const TIEMPO_MAXIMO_MS = 180000;    // 3 minutos por petición
const MAX_INTENTOS = 10;            // tope duro para no gastar de más
const TOPE_USD_DEFAULT = 0.05;      // tope duro de costo del modo lote (--tope-usd)

// -----------------------------------------------------------------------------
// 3. Lectura de argumentos de la línea de comandos.
//    --modelo <id>   cambia el modelo (default gpt-6-luna)
//    --prueba-b      ejecuta la prueba B (sección 12)
//    --esfuerzo <none|low|ninguno>, --quitar-claves <a,b>, --sin-llamada: solo prueba B
//    --lote <nombre> [--n N | --ids A,B] [--tope-usd X]: prueba B en modo lote (12b)
// -----------------------------------------------------------------------------
function leerArgumentos(argv) {
  const args = {
    modelo: MODELO_DEFAULT, pruebaB: false, esfuerzo: undefined, quitarClaves: undefined, sinLlamada: false,
    // Modo lote de la prueba B (sección 12b).
    lote: null, n: 2, ids: null, topeUsd: TOPE_USD_DEFAULT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--modelo') {
      args.modelo = argv[i + 1];
      i++;
    } else if (a.startsWith('--modelo=')) {
      args.modelo = a.slice('--modelo='.length);
    } else if (a === '--prueba-b') {
      args.pruebaB = true;
    } else if (a === '--esfuerzo') {
      // Prueba B: fuerza reasoning.effort (y quita temperature). "ninguno" = usar temperature.
      args.esfuerzo = argv[i + 1] === 'ninguno' ? null : argv[i + 1];
      i++;
    } else if (a === '--quitar-claves') {
      // Prueba B: claves a quitar del esquema, separadas por coma (formato de limpiarEsquema de JS-4).
      args.quitarClaves = String(argv[i + 1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      i++;
    } else if (a === '--sin-llamada') {
      args.sinLlamada = true;
    } else if (a === '--lote') {
      args.lote = argv[i + 1];
      i++;
    } else if (a === '--n') {
      args.n = Number(argv[i + 1]);
      i++;
    } else if (a === '--ids') {
      args.ids = String(argv[i + 1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      i++;
    } else if (a === '--tope-usd') {
      args.topeUsd = Number(argv[i + 1]);
      i++;
    }
  }
  if (!args.modelo) {
    console.error('Error: --modelo requiere un valor, por ejemplo --modelo gpt-6-luna');
    process.exit(1);
  }
  return args;
}

// -----------------------------------------------------------------------------
// 4. Conversación ficticia de la prueba A.
//    Ya viene enmascarada ([NOMBRE_1], [EMAIL_1]) y numerada, igual que la
//    construirá JS-4. Es mínima a propósito para que la prueba sea barata.
//    El catálogo y el artículo de abajo son SOLO de esta prueba; no son la base
//    de conocimiento real del proyecto (esa vive en datos/).
// -----------------------------------------------------------------------------
const INSTRUCCION_PRUEBA_A = [
  'Eres un evaluador de calidad de conversaciones de soporte por chat.',
  'Esta es una PRUEBA TÉCNICA de formato: responde únicamente con el JSON que exige el esquema.',
  'Cita solo números de mensaje que existan en la conversación. Si no hay evidencia, no la inventes.',
  'Justificaciones de una frase, en español.',
].join(' ');

const CONTEXTO_PRUEBA_A = `CATÁLOGO DE TEMAS (solo para esta prueba):
- Cancelación de CFDI
- Permisos de usuarios

BASE DE CONOCIMIENTO (solo para esta prueba):
KB-01 Cancelación de CFDI: el cliente cancela desde Facturación > Emitidas > Cancelar, elige el motivo SAT; si el motivo es 01 debe indicar el folio que sustituye. Si el receptor debe aceptar, la cancelación queda en proceso hasta 72 horas.

CONVERSACIÓN (enmascarada, mensajes numerados):
[1] cliente 10:00:05 | Hola, soy [NOMBRE_1], mi correo es [EMAIL_1]. Necesito cancelar una factura que emití con un error en el monto.
[2] agente 10:00:40 | Hola, [NOMBRE_1], gracias por escribirnos. Lamento el inconveniente. Para cancelarla entra a Facturación > Emitidas > Cancelar y elige el motivo 01, indicando el folio de la factura que la sustituye.
[3] cliente 10:02:10 | Listo, ya aparece en proceso. ¿Cuánto tarda?
[4] agente 10:02:45 | Si el receptor debe aceptarla, puede tardar hasta 72 horas. En resumen: cancelaste con motivo 01 y queda en espera de aceptación. ¿Te ayudo con algo más?`;

// -----------------------------------------------------------------------------
// 5. Variantes del esquema (prueba A2).
//    Cada variante quita una clave más que la anterior. Se avanza a la
//    siguiente solo si el error de la API apunta al esquema.
//    La variante 3 (minItems) es una extensión: atiende el pendiente 3
//    (M6) del registro técnico, que también menciona minItems.
// -----------------------------------------------------------------------------
const VARIANTES_ESQUEMA = [
  { id: 0, descripcion: 'esquema tal cual (contrato/llm_output.schema.json)', quitar: [] },
  { id: 1, descripcion: 'sin $schema ni title en la raíz', quitar: ['$schema', 'title'] },
  {
    id: 2,
    descripcion: 'sin $schema, title y minimum en primer_mensaje_info_cuenta.mensaje_n',
    quitar: ['$schema', 'title', 'minimum(primer_mensaje_info_cuenta.mensaje_n)'],
  },
  {
    id: 3,
    descripcion: 'además sin minItems en solicitudes_cliente (extensión, pendiente M6)',
    quitar: ['$schema', 'title', 'minimum(primer_mensaje_info_cuenta.mensaje_n)', 'minItems(solicitudes_cliente)'],
  },
];

// Construye la variante pedida a partir del esquema original.
// structuredClone hace una copia profunda: el original no se modifica.
function construirEsquema(original, variante) {
  const esquema = structuredClone(original);
  if (variante.id >= 1) {
    delete esquema.$schema;
    delete esquema.title;
  }
  if (variante.id >= 2) {
    delete esquema.properties.primer_mensaje_info_cuenta.properties.mensaje_n.minimum;
  }
  if (variante.id >= 3) {
    delete esquema.properties.solicitudes_cliente.minItems;
  }
  return esquema;
}

// -----------------------------------------------------------------------------
// 6. Variantes de parámetros de muestreo (prueba A3).
//    0: temperature 0 (lo que pide config.md, llm_temperatura = 0).
//    1: sin temperature, con reasoning.effort = "none".
//    2: sin temperature, con reasoning.effort = "low".
// -----------------------------------------------------------------------------
const VARIANTES_PARAMETROS = [
  { id: 0, descripcion: 'temperature 0', temperature: 0, reasoning: null },
  { id: 1, descripcion: 'sin temperature, reasoning.effort none', temperature: null, reasoning: { effort: 'none' } },
  { id: 2, descripcion: 'sin temperature, reasoning.effort low', temperature: null, reasoning: { effort: 'low' } },
];

// -----------------------------------------------------------------------------
// 7. Cuerpo de la petición a la API Responses.
//    Forma: { model, instructions, input, text.format (json_schema estricto),
//             max_output_tokens, store, [temperature], [reasoning] }
// -----------------------------------------------------------------------------
function construirCuerpo(modelo, esquema, parametros) {
  const cuerpo = {
    model: modelo,
    instructions: INSTRUCCION_PRUEBA_A,
    input: [{ role: 'user', content: CONTEXTO_PRUEBA_A }],
    text: {
      format: {
        type: 'json_schema',
        name: 'evaluacion_ce',
        strict: true,
        schema: esquema,
      },
    },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false, // no guardar la respuesta en OpenAI
  };
  if (parametros.temperature !== null) cuerpo.temperature = parametros.temperature;
  if (parametros.reasoning !== null) cuerpo.reasoning = parametros.reasoning;
  return cuerpo;
}

// -----------------------------------------------------------------------------
// 8. Clasificación del error.
//    La API devuelve { error: { message, type, param, code } }. Se busca en
//    "param" y en "message" qué parte de la petición causó el rechazo.
//    Devuelve:
//      categoria: 'temperature' | 'reasoning' | 'esquema' | 'otro'
//      claves_mencionadas: claves candidatas que aparecen literalmente
// -----------------------------------------------------------------------------
const CLAVES_CANDIDATAS = ['$schema', 'title', 'minimum', 'minItems', 'temperature', 'reasoning.effort', 'reasoning'];

function clasificarError(error) {
  const mensaje = String(error?.message ?? '');
  const param = String(error?.param ?? '');
  const texto = `${param} ${mensaje}`;
  const claves_mencionadas = CLAVES_CANDIDATAS.filter((c) => texto.includes(c));

  let categoria = 'otro';
  if (/temperature/i.test(texto)) categoria = 'temperature';
  else if (/reasoning/i.test(texto)) categoria = 'reasoning';
  else if (/schema|json_schema|text\.format/i.test(texto)) categoria = 'esquema';
  return { categoria, claves_mencionadas };
}

// -----------------------------------------------------------------------------
// 9. Extrae el texto de salida de la respuesta.
//    En la API Responses, response.output es una lista de elementos; el texto
//    del modelo está en los elementos type "message", dentro de content con
//    type "output_text". Si el modelo se niega, aparece type "refusal".
// -----------------------------------------------------------------------------
function extraerTexto(respuesta) {
  let texto = '';
  let rechazo = false;
  for (const item of respuesta?.output ?? []) {
    if (item.type !== 'message') continue;
    for (const parte of item.content ?? []) {
      if (parte.type === 'output_text') texto += parte.text ?? '';
      if (parte.type === 'refusal') rechazo = true;
    }
  }
  return { texto, rechazo };
}

// Costo de un intento con los precios de gpt-6-luna.
function calcularCosto(usage) {
  if (!usage) return 0;
  const entrada = usage.input_tokens ?? 0;
  const salida = usage.output_tokens ?? 0; // ya incluye los reasoning tokens
  return (entrada * PRECIO_ENTRADA_USD_MILLON + salida * PRECIO_SALIDA_USD_MILLON) / 1_000_000;
}

// -----------------------------------------------------------------------------
// 10. Un intento: envía la petición y registra solo lo observado.
// -----------------------------------------------------------------------------
async function ejecutarIntento(numero, clave, modelo, esquemaOriginal, vEsquema, vParam, nombrePrueba) {
  const esquema = construirEsquema(esquemaOriginal, vEsquema);
  const cuerpo = construirCuerpo(modelo, esquema, vParam);

  // Registro de lo enviado, sin clave, sin esquema completo ni prompt completo.
  const registro = {
    intento: numero,
    prueba: nombrePrueba,
    parametros_enviados: {
      endpoint: 'POST ' + URL_API,
      model: cuerpo.model,
      temperature: cuerpo.temperature ?? '(no enviado)',
      reasoning: cuerpo.reasoning ?? '(no enviado)',
      text_format: { type: 'json_schema', name: 'evaluacion_ce', strict: true },
      max_output_tokens: cuerpo.max_output_tokens,
      store: cuerpo.store,
      variante_esquema: vEsquema.descripcion,
      claves_quitadas_del_esquema: vEsquema.quitar,
    },
    http_status: null,
    exito: false,
    error: null,
  };

  console.log(`\nIntento ${numero} (${nombrePrueba}): ${vParam.descripcion} | ${vEsquema.descripcion}`);

  let respuestaHttp;
  try {
    respuestaHttp = await fetch(URL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clave}`, // la clave solo viaja aquí
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
  } catch (e) {
    // Falla de red o tiempo agotado: no hay código HTTP.
    registro.error = { tipo: 'red_o_tiempo', mensaje_literal: String(e?.message ?? e) };
    registro.clasificacion_error = { categoria: 'red', claves_mencionadas: [] };
    console.log(`  Falla de red: ${registro.error.mensaje_literal}`);
    return registro;
  }

  registro.http_status = respuestaHttp.status;
  const textoCrudo = await respuestaHttp.text();
  let json = null;
  try {
    json = JSON.parse(textoCrudo);
  } catch {
    // Respuesta no JSON (raro). Se guarda solo un fragmento corto.
    registro.error = { tipo: 'respuesta_no_json', fragmento: textoCrudo.slice(0, 300) };
    registro.clasificacion_error = { categoria: 'otro', claves_mencionadas: [] };
    return registro;
  }

  if (!respuestaHttp.ok) {
    // Error de la API: se guarda el mensaje literal completo (no contiene datos sensibles).
    registro.error = {
      mensaje_literal: json?.error?.message ?? null,
      type: json?.error?.type ?? null,
      param: json?.error?.param ?? null,
      code: json?.error?.code ?? null,
    };
    registro.clasificacion_error = clasificarError(json?.error);
    console.log(`  HTTP ${respuestaHttp.status}: ${registro.error.mensaje_literal}`);
    return registro;
  }

  // Éxito HTTP. Se registran status, usage completo y si la salida parsea.
  const usage = json.usage ?? null;
  const { texto, rechazo } = extraerTexto(json);
  let parsea = false;
  let clavesRaiz = [];
  try {
    const salida = JSON.parse(texto);
    parsea = true;
    clavesRaiz = Object.keys(salida);
  } catch {
    parsea = false;
  }

  const requeridas = esquemaOriginal.required ?? [];
  registro.exito = true;
  registro.respuesta = {
    status: json.status ?? null,                       // completed | incomplete | ...
    incomplete_details: json.incomplete_details ?? null,
    modelo_reportado: json.model ?? null,
    temperature_reportada: json.temperature ?? null,
    reasoning_reportado: json.reasoning ?? null,
    usage,                                             // usage completo tal como llega
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    reasoning_tokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
    hubo_refusal: rechazo,
    longitud_texto_salida: texto.length,
    salida_parsea_json: parsea,
    claves_raiz_faltantes: parsea ? requeridas.filter((k) => !clavesRaiz.includes(k)) : null,
  };
  registro.costo_usd = calcularCosto(usage);

  console.log(
    `  HTTP ${respuestaHttp.status} | status ${registro.respuesta.status} | ` +
      `entrada ${registro.respuesta.input_tokens} | salida ${registro.respuesta.output_tokens} ` +
      `(reasoning ${registro.respuesta.reasoning_tokens}) | parsea JSON: ${parsea} | ` +
      `costo USD ${registro.costo_usd.toFixed(6)}`
  );
  return registro;
}

// -----------------------------------------------------------------------------
// 11. Prueba A: bucle de intentos.
//     Empieza en A1 (esquema tal cual + temperature 0). Según el error:
//       - temperature  -> A3: avanza variante de parámetros (none, luego low)
//       - reasoning    -> A3: avanza de none a low
//       - esquema      -> A2: avanza variante de esquema
//       - otro / red   -> se detiene (no se adivina la causa)
//     Así, si fallan las dos cosas, se resuelven una por una.
// -----------------------------------------------------------------------------
async function pruebaA(clave, modelo) {
  const esquemaOriginal = JSON.parse(await readFile(RUTA_ESQUEMA, 'utf8'));
  const intentos = [];
  let iEsquema = 0;
  let iParam = 0;
  let conclusion = null;

  for (let n = 1; n <= MAX_INTENTOS; n++) {
    // Nombre del paso para el reporte.
    let nombre = 'A1';
    if (iEsquema > 0 && iParam > 0) nombre = 'A2+A3';
    else if (iEsquema > 0) nombre = 'A2';
    else if (iParam > 0) nombre = 'A3';

    const r = await ejecutarIntento(
      n, clave, modelo, esquemaOriginal, VARIANTES_ESQUEMA[iEsquema], VARIANTES_PARAMETROS[iParam], nombre
    );
    intentos.push(r);

    if (r.exito) {
      conclusion = {
        aceptado: true,
        variante_esquema_aceptada: VARIANTES_ESQUEMA[iEsquema].descripcion,
        claves_que_hubo_que_quitar: VARIANTES_ESQUEMA[iEsquema].quitar,
        parametros_aceptados: VARIANTES_PARAMETROS[iParam].descripcion,
      };
      break;
    }

    const cat = r.clasificacion_error?.categoria;
    if ((cat === 'temperature' || cat === 'reasoning') && iParam < VARIANTES_PARAMETROS.length - 1) {
      iParam++;
    } else if (cat === 'esquema' && iEsquema < VARIANTES_ESQUEMA.length - 1) {
      iEsquema++;
    } else {
      conclusion = {
        aceptado: false,
        motivo_detencion:
          cat === 'esquema' || cat === 'temperature' || cat === 'reasoning'
            ? `se agotaron las variantes para la categoría ${cat}`
            : `error no clasificable (${cat}); revisar el mensaje literal del último intento`,
      };
      break;
    }
  }

  if (!conclusion) conclusion = { aceptado: false, motivo_detencion: `se alcanzó el tope de ${MAX_INTENTOS} intentos` };

  // Lista de rechazos observados: qué clave mencionó cada error (solo lo literal).
  conclusion.rechazos_observados = intentos
    .filter((r) => !r.exito)
    .map((r) => ({
      intento: r.intento,
      http_status: r.http_status,
      categoria: r.clasificacion_error?.categoria ?? null,
      claves_mencionadas_en_error: r.clasificacion_error?.claves_mencionadas ?? [],
      mensaje_literal: r.error?.mensaje_literal ?? r.error?.fragmento ?? null,
    }));

  const costoTotal = intentos.reduce((s, r) => s + (r.costo_usd ?? 0), 0);
  return { intentos, conclusion, costoTotal };
}

// -----------------------------------------------------------------------------
// 12. Prueba B: una evaluación real con el prompt v1.
//     Flujo (igual que el Workflow 2, pasos 2 a 7):
//       payload_ejemplo.json -> JS-1 (normalizacion.js) -> JS-2 (enmascaramiento.js)
//       -> JS-4 (construccion_prompt.js) -> OpenAI -> JS-5 (validador_llm.js)
//       -> si es inválida, reintento con los errores (máximo
//          config.reintentos_validacion_llm reenvíos).
//     Dependencias de reglas-js: js/normalizacion.js y js/enmascaramiento.js.
//     Si no existen, la prueba se detiene con un aviso (no enmascara por su cuenta:
//     el LLM nunca debe ver datos sin enmascarar).
//     termina_por_inactividad: lo calcula JS-3 (js/reglas.js) si existe; si no,
//     se usa false (el payload de ejemplo no tiene recordatorio ni cierre).
//     Guarda en resultados_prueba_b_AAAAMMDD-HHMMSS.json SOLO tokens, costo, validez y errores.
// -----------------------------------------------------------------------------
const RUTA_PAYLOAD_B = path.join(RAIZ_REPO, 'contrato', 'ejemplos', 'payload_ejemplo.json');
const RUTA_PLANTILLA_B = path.join(RAIZ_REPO, 'prompts', 'evaluador_ce_v1.md');
const RUTA_CONFIG_MD = path.join(RAIZ_REPO, 'contrato', 'config.md');
const RUTA_RESULTADOS_A = path.join(CARPETA_SCRIPT, 'resultados_prueba_a.json');
// Cada corrida real guarda un archivo nuevo con fecha y hora local en el nombre
// (AAAAMMDD-HHMMSS) para no sobrescribir corridas anteriores.
function sufijoFechaHora(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
const RUTA_RESULTADOS_B = path.join(CARPETA_SCRIPT, `resultados_prueba_b_${sufijoFechaHora()}.json`);

// Lee las tablas de contrato/config.md como filas de la hoja config
// ({ clave, tipo_interaccion, valor, tipo }). El ámbito sale de la columna
// "Ámbito" si existe o del título de la sección "(ámbito `x`)".
function leerConfigMd(texto) {
  const filas = [];
  let ambitoSeccion = null;
  let columnas = null;
  const celdas = (linea) =>
    linea.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|').replace(/`/g, ''));
  for (const linea of texto.replace(/\r\n/g, '\n').split('\n')) {
    if (/^##\s/.test(linea)) {
      const titulo = /ámbito `(\w+)`/.exec(linea);
      ambitoSeccion = titulo ? titulo[1] : null;
      columnas = null;
      continue;
    }
    if (!linea.startsWith('|')) {
      columnas = null;
      continue;
    }
    const c = celdas(linea);
    if (c[0] === 'Clave') {
      columnas = c;
      continue;
    }
    if (!columnas || /^-+$/.test(c[0])) continue;
    const col = (nombre) => c[columnas.indexOf(nombre)];
    const ambito = columnas.includes('Ámbito') ? col('Ámbito') : ambitoSeccion;
    if (!ambito) continue;
    filas.push({ clave: col('Clave'), tipo_interaccion: ambito, valor: col('Valor por defecto'), tipo: col('Tipo') });
  }
  return filas;
}

// Traduce lo que aceptó la prueba A al formato de JS-4.
//   'minimum(primer_mensaje_info_cuenta.mensaje_n)' -> 'minimum@primer_mensaje_info_cuenta.mensaje_n'
function parametrosDesdePruebaA(resultadosA) {
  const c = resultadosA?.conclusion;
  if (!c?.aceptado) return null;
  const claves = (c.claves_que_hubo_que_quitar || []).map((k) => {
    const m = /^([$\w]+)\(([^)]+)\)$/.exec(k);
    return m ? `${m[1]}@${m[2]}` : k;
  });
  const p = String(c.parametros_aceptados || '');
  const esfuerzo = /reasoning\.effort none/.test(p) ? 'none' : /reasoning\.effort low/.test(p) ? 'low' : null;
  return { claves, esfuerzo };
}

async function pruebaB(args) {
  const require = createRequire(import.meta.url);
  const rutaJs = (archivo) => path.join(RAIZ_REPO, 'js', archivo);

  // Dependencias de reglas-js (JS-1 y JS-2).
  for (const archivo of ['normalizacion.js', 'enmascaramiento.js']) {
    if (!existsSync(rutaJs(archivo))) {
      console.error(`Falta js/${archivo} (de reglas-js). La prueba B necesita JS-1 y JS-2 para enmascarar antes de enviar a OpenAI.`);
      process.exit(1);
    }
  }
  const js1 = require(rutaJs('normalizacion.js'));
  const js2 = require(rutaJs('enmascaramiento.js'));
  const js4 = require(rutaJs('construccion_prompt.js'));
  const js5 = require(rutaJs('validador_llm.js'));
  const ref = require(path.join(RAIZ_REPO, 'js', 'tests', 'construccion_prompt_datos_referencia.js'));

  // Datos: solo el ejemplo del contrato y los datos de referencia (nunca datos/lotes/).
  const payload = JSON.parse(await readFile(RUTA_PAYLOAD_B, 'utf8'));
  const esquema = JSON.parse(await readFile(RUTA_ESQUEMA, 'utf8'));
  const plantilla = await readFile(RUTA_PLANTILLA_B, 'utf8');
  const filasConfig = leerConfigMd(await readFile(RUTA_CONFIG_MD, 'utf8'));
  const filasListas = ref.leerCsv(await readFile(path.join(RAIZ_REPO, 'datos', 'listas.csv'), 'utf8'));
  const catalogo = ref.cargarCatalogo();
  const base = ref.cargarBase();
  const cuentas = ref.cargarCuentas();

  // JS-1 y JS-2.
  const ctx = js1.prepararContexto({ payload, lote: 'demo', filasConfig, filasListas, filasCatalogo: catalogo, filasCuentas: cuentas });
  if (ctx.conversacion.sin_mensajes_agente) {
    console.error('El payload de ejemplo no tiene mensajes del agente: no se llama al LLM (rubrica.md 3.12).');
    process.exit(1);
  }
  const extraccion = js2.extraerYEnmascarar(ctx);
  const mensajes = extraccion.mensajes_enmascarados;

  // termina_por_inactividad: de JS-3 (js/reglas.js) si existe; si no, false
  // (el payload de ejemplo no tiene recordatorio ni cierre por inactividad).
  let terminaPorInactividad = false;
  let origenInactividad = 'valor fijo false (js/reglas.js no disponible)';
  if (existsSync(rutaJs('reglas.js'))) {
    const js3 = require(rutaJs('reglas.js'));
    terminaPorInactividad = js3.evaluarReglasJS({ ...ctx, extraccion }).variables.termina_por_inactividad;
    origenInactividad = 'JS-3 (js/reglas.js)';
  }

  // Parámetros: los de la línea de comandos tienen prioridad; si no, los de la prueba A.
  let origen = 'valores por defecto (temperature de config, esquema sin cambios)';
  let claves = [];
  let esfuerzo = null;
  if (existsSync(RUTA_RESULTADOS_A)) {
    const p = parametrosDesdePruebaA(JSON.parse(await readFile(RUTA_RESULTADOS_A, 'utf8')));
    if (p) {
      claves = p.claves;
      esfuerzo = p.esfuerzo;
      origen = 'resultados_prueba_a.json';
    }
  } else {
    console.log('AVISO: no existe resultados_prueba_a.json; se usan los valores por defecto.');
  }
  if (args.quitarClaves !== undefined) {
    claves = args.quitarClaves;
    origen = 'línea de comandos';
  }
  if (args.esfuerzo !== undefined) {
    esfuerzo = args.esfuerzo;
    origen = 'línea de comandos';
  }

  // JS-4. config.md trae modelo_evaluador = por_verificar; se usa el de --modelo.
  const config = { ...ctx.config, modelo_evaluador: args.modelo };
  let cuerpo = js4.construirPeticion(
    {
      plantilla,
      esquema,
      mensajes,
      termina_por_inactividad: terminaPorInactividad,
      catalogo_temas: catalogo,
      base_conocimiento: base,
      tipo_interaccion: payload.tipo_interaccion,
      config,
    },
    { claves_esquema_no_aceptadas: claves, esfuerzo_razonamiento: esfuerzo, max_tokens_salida: MAX_OUTPUT_TOKENS }
  );
  const tamanos = {
    caracteres_instrucciones: cuerpo.instructions.length,
    caracteres_entrada: cuerpo.input[0].content.length,
    caracteres_esquema: JSON.stringify(cuerpo.text.format.schema).length,
    mensajes_conversacion: mensajes.length,
  };
  console.log(`Prueba B con modelo ${args.modelo} | parámetros desde: ${origen}`);
  console.log(
    `  temperature: ${cuerpo.temperature ?? '(no enviado)'} | reasoning: ${JSON.stringify(cuerpo.reasoning ?? '(no enviado)')} | ` +
      `claves quitadas: ${claves.join(', ') || 'ninguna'}`
  );
  console.log(`  Tamaños (caracteres): ${JSON.stringify(tamanos)}`);
  console.log(`  termina_por_inactividad: ${terminaPorInactividad} (${origenInactividad})`);

  if (args.sinLlamada) {
    console.log('--sin-llamada: no se llamó a la API ni se escribió resultados_prueba_b_<fecha-hora>.json.');
    return;
  }

  const clave = process.env.OPENAI_API_KEY;
  if (!clave || clave.trim() === '') {
    console.error('Falta OPENAI_API_KEY (ver prompts/verificacion/README.md).');
    process.exit(1);
  }
  if (args.modelo !== MODELO_DEFAULT) {
    console.log(`AVISO: los precios usados son los de ${MODELO_DEFAULT}; el costo mostrado no aplica a ${args.modelo}.`);
  }

  const maxIntentos = 1 + Number(ctx.config.reintentos_validacion_llm ?? 2);
  const intentos = [];
  let validoFinal = false;
  for (let n = 1; n <= maxIntentos; n++) {
    const registro = {
      intento: n,
      http_status: null,
      status: null,
      input_tokens: null,
      cached_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      costo_usd: 0,
      valido: false,
      errores: [],
      estructura_salida: null, // forma de la salida sin texto (extraerTextoSalida de JS-5)
    };
    intentos.push(registro);
    let respuestaHttp;
    try {
      respuestaHttp = await fetch(URL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` }, // la clave solo viaja aquí
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
    } catch (e) {
      registro.errores = [`falla de red o tiempo agotado: ${String(e?.message ?? e)}`];
      console.log(`  Intento ${n}: ${registro.errores[0]}`);
      break;
    }
    registro.http_status = respuestaHttp.status;
    const json = await respuestaHttp.json().catch(() => null);
    if (!respuestaHttp.ok || !json) {
      registro.errores = [`HTTP ${respuestaHttp.status}: ${json?.error?.message ?? 'respuesta no JSON'}`];
      console.log(`  Intento ${n}: ${registro.errores[0]}`);
      break;
    }
    const usage = json.usage ?? null;
    registro.status = json.status ?? null;
    registro.input_tokens = usage?.input_tokens ?? null;
    registro.cached_tokens = usage?.input_tokens_details?.cached_tokens ?? null;
    registro.output_tokens = usage?.output_tokens ?? null;
    registro.reasoning_tokens = usage?.output_tokens_details?.reasoning_tokens ?? null;
    registro.costo_usd = Number(calcularCosto(usage).toFixed(6));

    // JS-5.
    const { texto, rechazo, estructura, falla_estructura } = js5.extraerTextoSalida(json);
    registro.estructura_salida = estructura;
    if (falla_estructura) {
      // Salida ambigua de la API (por ejemplo, dos final_answer): no se valida ni
      // se gasta un reintento de JS-5; en W2 es log_errores con tipo_error fallo_api.
      registro.errores = [falla_estructura.mensaje];
      registro.falla_estructura = falla_estructura.causa;
      console.log(`  Intento ${n}: HTTP ${registro.http_status} | status ${registro.status} | falla estructural de la salida (${falla_estructura.causa}); se detiene sin reintento de JS-5.`);
      break;
    }
    const resultado = js5.validarRespuestaLlm(texto, {
      esquema,
      mensajes,
      catalogo_temas: catalogo,
      base_conocimiento: base,
      tipo_interaccion: payload.tipo_interaccion,
      termina_por_inactividad: terminaPorInactividad,
    });
    if (rechazo) resultado.errores.unshift('El modelo se negó a responder (refusal).');
    registro.valido = resultado.valido && !rechazo;
    registro.errores = resultado.errores;
    console.log(
      `  Intento ${n}: HTTP ${registro.http_status} | status ${registro.status} | entrada ${registro.input_tokens} ` +
        `(caché ${registro.cached_tokens}) | salida ${registro.output_tokens} (reasoning ${registro.reasoning_tokens}) | ` +
        `costo USD ${registro.costo_usd.toFixed(6)} | válida: ${registro.valido}` +
        (registro.valido ? '' : ` (${registro.errores.length} errores)`) +
        (estructura.anomalias.length ? ` | anomalías de salida: ${estructura.anomalias.join(', ')} (${estructura.caracteres_ignorados} caracteres ignorados)` : '')
    );
    if (registro.valido) {
      validoFinal = true;
      break;
    }
    if (n < maxIntentos) cuerpo = js4.agregarReintento(cuerpo, texto, js5.redactarMensajeReintento(resultado));
  }

  const suma = (k) => intentos.reduce((s, r) => s + (r[k] ?? 0), 0);
  const resultados = {
    fecha_ejecucion: new Date().toISOString(),
    node: process.version,
    modelo_solicitado: args.modelo,
    version_prompt: config.version_prompt,
    precios_usd_millon: { modelo: MODELO_DEFAULT, entrada: PRECIO_ENTRADA_USD_MILLON, salida: PRECIO_SALIDA_USD_MILLON },
    parametros: {
      origen,
      temperature: cuerpo.temperature ?? null,
      reasoning: cuerpo.reasoning ?? null,
      claves_quitadas_del_esquema: claves,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    },
    entrada: {
      payload: 'contrato/ejemplos/payload_ejemplo.json',
      termina_por_inactividad: terminaPorInactividad,
      origen_termina_por_inactividad: origenInactividad,
      nota:
        'El payload de ejemplo tiene textos de relleno ("..."): la conversación es mínima, así que el costo medido ' +
        'subestima una conversación real (faltan unos 800 a 1,500 tokens de entrada de la conversación).',
      ...tamanos,
    },
    intentos,
    totales: {
      intentos_llm: intentos.length,
      valida_al_final: validoFinal,
      tokens_entrada: suma('input_tokens'),
      tokens_salida: suma('output_tokens'),
      costo_usd: Number(suma('costo_usd').toFixed(6)),
    },
  };
  await writeFile(RUTA_RESULTADOS_B, JSON.stringify(resultados, null, 2) + '\n', 'utf8');
  console.log('\n===== RESUMEN PRUEBA B =====');
  console.log(`Válida al final: ${validoFinal} | intentos: ${intentos.length} | costo total USD ${resultados.totales.costo_usd.toFixed(6)}`);
  console.log(`Resultados guardados en ${path.relative(RAIZ_REPO, RUTA_RESULTADOS_B)}`);
}

// -----------------------------------------------------------------------------
// 12b. Prueba B en modo lote (--prueba-b --lote <nombre>).
//      Para cada conversación de datos/lotes/<lote>/ (primeras N por ID, o las de
//      --ids):
//        JS-1..JS-3 (contextoHastaJS3 de js/tests/ayudas.js, con datos/config.csv)
//        -> JS-4 (construccion_prompt.js, parámetros de config: modelo, reasoning,
//           claves del esquema) -> OpenAI -> JS-5 (validador_llm.js) con
//           reintentos según config.reintentos_validacion_llm
//        -> JS-6..JS-8 (evaluar de js/tests/ayudas.js: reglas_hibridas, scoring, costo)
//        -> comparación contra _escenarios.json, igual que
//           js/tests/lote_calibracion_v1.test.js.
//      No copia lógica de js/: usa los módulos tal como estén.
//
//      TOPE DURO DE COSTO: antes de cada llamada, si el costo acumulado ya
//      alcanzó --tope-usd (default 0.05), se detiene. Una sola llamada puede
//      rebasar el tope como máximo por su propio costo (peor caso con
//      max_output_tokens = 8000: unos USD 0.005).
//
//      SALIDA SOLO AGREGADA (regla del dueño, calificación a ciegas): nada por
//      conversación (ni IDs con nota, ni criterios, ni justificaciones, ni la
//      respuesta del LLM). Los errores se agrupan por tipo, sin textos citados.
//      Excepción acotada: diagnostico_raiz (ver registrarDiagnosticoRaiz).
//
//      --sin-llamada: en lugar de OpenAI usa la salida simulada de
//      js/tests/lote_simulacion.js (no es una predicción del LLM), sin tokens ni
//      costo, y no escribe archivos. Sirve para comprobar que la salida no
//      filtra nada por conversación.
// -----------------------------------------------------------------------------
// Va en _privado/ (fuera de Git, ver .gitignore) porque compara contra la verdad
// de escenarios de calibracion_v1; se restaura al cerrar la Fase 3.
const CARPETA_PRIVADA = path.join(CARPETA_SCRIPT, '_privado');
const RUTA_RESULTADOS_B_LOTE = path.join(CARPETA_PRIVADA, `resultados_prueba_b_lote_${sufijoFechaHora()}.json`);

// Tipo agregado de un error de JS-5: regla de rubrica.md 6.1 + campo raíz de la
// ruta (sin índices ni subcampos). El mensaje NO se guarda: puede citar texto
// de la conversación.
function tipoErrorJs5(d) {
  const raiz = String(d?.ruta ?? '(raíz)').split(/[.[]/)[0] || '(raíz)';
  return `regla ${d?.regla ?? '?'} | ${raiz}`;
}

// Mensaje de excepción sin IDs de conversación ni números.
function tipoExcepcion(e) {
  return String(e?.message ?? e).replace(/CONV-\d+/g, 'CONV-*').replace(/\d+/g, '#').slice(0, 120);
}

const sumarEn = (obj, clave, k = 1) => {
  obj[clave] = (obj[clave] ?? 0) + k;
};

// Diagnóstico de un intento rechazado con regla 1 en la raíz. Guarda:
//   - mensajes_js5: el texto del error SOLO si js5.mensajeRaizSinContenido lo
//     reconoce como mensaje fijo (causa, posiciones y longitudes; nunca texto
//     de la respuesta ni de la conversación). Cualquier otro texto se cuenta
//     como "(mensaje con contenido: no se guarda)".
//   - forma_salida: status, incomplete_details.reason, items por tipo, número
//     de mensajes y de partes output_text, y phase (etiquetas de la API).
//   - tokens de salida del intento (sin ID ni orden: se ordenan al guardar).
// Ejemplos de lectura: "llegó vacía" + 0 mensajes -> la salida no trajo item
// message; "dos o más objetos" + 2 mensajes -> extraerTextoSalida concatenó
// dos mensajes; "posición N de 2N" -> el mismo objeto repetido.
function registrarDiagnosticoRaiz(diag, detalle, js5, estado, estructura, uso) {
  const deRaiz = detalle.filter((d) => d.regla === '1' && d.ruta === '(raíz)');
  if (deRaiz.length === 0) return;
  for (const d of deRaiz) sumarEn(diag.mensajes_js5, js5.mensajeRaizSinContenido(d) ?? '(mensaje con contenido: no se guarda)');
  const forma = estructura
    ? `status ${estado} | incompleto_por ${estructura.incompleto_por} | items ${JSON.stringify(estructura.items_por_tipo)} | mensajes ${estructura.mensajes} | partes_output_text ${estructura.partes_output_text} | fases ${JSON.stringify(estructura.fases)} | anomalias ${JSON.stringify(estructura.anomalias ?? [])}`
    : '(sin respuesta de la API: modo --sin-llamada)';
  sumarEn(diag.forma_salida, forma);
  if (uso) {
    diag.tokens_salida_intentos_rechazados.push(uso.tokens_salida);
    diag.tokens_salida_intentos_rechazados.sort((a, b) => a - b);
  }
}
// Anomalías de la salida de la API en un intento (válido o no). Solo etiquetas
// fijas de extraerTextoSalida y números; nada de texto ni ID de conversación.
function registrarAnomaliasSalida(an, estructura, uso) {
  if (!estructura || !Array.isArray(estructura.anomalias) || estructura.anomalias.length === 0) return;
  an.intentos_con_anomalia++;
  for (const a of estructura.anomalias) sumarEn(an.por_tipo, a);
  an.caracteres_ignorados.push(estructura.caracteres_ignorados ?? 0);
  an.caracteres_ignorados.sort((a, b) => a - b);
  if (uso) {
    an.tokens_salida.push(uso.tokens_salida);
    an.tokens_salida.sort((a, b) => a - b);
  }
}
const porcentaje = (a, b) => (b > 0 ? Number(((100 * a) / b).toFixed(2)) : null);

// Copia de la salida del LLM con criticos_posibles neutralizados (todos
// detectado = false). Sirve para saber qué críticos activó SOLO la parte LLM:
// los que dejan de detectarse al volver a correr JS-6..JS-7 sin ellos.
function sinCriticosLlm(llm) {
  const copia = structuredClone(llm);
  for (const k of Object.keys(copia.criticos_posibles ?? {})) {
    copia.criticos_posibles[k] = { detectado: false, mensajes: [], justificacion: 'Neutralizado para la medición solo-LLM.' };
  }
  return copia;
}

async function pruebaBLote(args) {
  const require = createRequire(import.meta.url);
  const rutaJs = (archivo) => path.join(RAIZ_REPO, 'js', archivo);
  const ayudas = require(rutaJs(path.join('tests', 'ayudas.js')));
  const { llmSimulado, separar } = require(rutaJs(path.join('tests', 'lote_simulacion.js')));
  const js4 = require(rutaJs('construccion_prompt.js'));
  const js5 = require(rutaJs('validador_llm.js'));
  const js8 = require(rutaJs('costo.js'));
  const ref = require(rutaJs(path.join('tests', 'construccion_prompt_datos_referencia.js')));

  // --- Validación de argumentos ---------------------------------------------
  if (!/^[a-z0-9_]+$/.test(String(args.lote))) {
    console.error('--lote requiere un nombre de lote, por ejemplo --lote calibracion_v1');
    process.exit(1);
  }
  const carpeta = path.join(RAIZ_REPO, 'datos', 'lotes', args.lote);
  const rutaEscenarios = path.join(carpeta, '_escenarios.json');
  if (!existsSync(rutaEscenarios)) {
    console.error(`No existe datos/lotes/${args.lote}/_escenarios.json.`);
    process.exit(1);
  }
  if (!Number.isFinite(args.topeUsd) || args.topeUsd <= 0) {
    console.error('--tope-usd debe ser un número mayor que 0 (por ejemplo 0.05).');
    process.exit(1);
  }
  const escenarios = JSON.parse(await readFile(rutaEscenarios, 'utf8'));
  const porId = new Map(escenarios.map((e) => [e.conversation_id, e]));
  const disponibles = [...porId.keys()].filter((id) => existsSync(path.join(carpeta, `${id}.json`))).sort();

  let seleccion;
  let criterioSeleccion;
  if (args.ids) {
    const faltan = args.ids.filter((id) => !porId.has(id));
    if (faltan.length) {
      // Solo se dice cuántos: el mensaje no repite IDs.
      console.error(`--ids: ${faltan.length} ID(s) no existen en el lote.`);
      process.exit(1);
    }
    seleccion = [...new Set(args.ids)];
    criterioSeleccion = { criterio: 'lista --ids', cantidad: seleccion.length };
  } else {
    if (!Number.isInteger(args.n) || args.n < 1) {
      console.error('--n debe ser un entero mayor o igual a 1.');
      process.exit(1);
    }
    seleccion = disponibles.slice(0, args.n);
    criterioSeleccion = { criterio: 'primeras N por conversation_id', n: args.n };
  }
  // Con una sola conversación el agregado ES el resultado por conversación.
  if (seleccion.length < 2) {
    console.error('El modo lote necesita al menos 2 conversaciones: con 1, el agregado revelaría su resultado individual.');
    process.exit(1);
  }

  // --- Datos de referencia y config -----------------------------------------
  const esquema = JSON.parse(await readFile(RUTA_ESQUEMA, 'utf8'));
  const catalogo = ref.cargarCatalogo();
  const base = ref.cargarBase();
  const config = ayudas.configCE(); // datos/config.csv, ámbito ce (igual que la hoja config)
  const plantilla = await readFile(path.join(RAIZ_REPO, 'prompts', `${config.version_prompt}.md`), 'utf8');
  const maxIntentos = 1 + Number(config.reintentos_validacion_llm ?? 2);
  const precioOk = typeof config.precio_entrada_usd_millon_evaluador === 'number' && typeof config.precio_salida_usd_millon_evaluador === 'number';
  if (!args.sinLlamada && !precioOk) {
    console.error('Los precios del evaluador en config no son números (por_verificar): no se puede aplicar el tope de costo.');
    process.exit(1);
  }

  let clave = null;
  if (!args.sinLlamada) {
    clave = process.env.OPENAI_API_KEY;
    if (!clave || clave.trim() === '') {
      console.error('Falta OPENAI_API_KEY (ver prompts/verificacion/README.md).');
      process.exit(1);
    }
  }

  const modo = args.sinLlamada ? 'simulado (--sin-llamada: salida de js/tests/lote_simulacion.js, sin API)' : 'real (OpenAI)';
  console.log(`Prueba B, modo lote | lote ${args.lote} | ${seleccion.length} conversaciones solicitadas | modo ${modo}`);
  console.log(`  modelo ${config.modelo_evaluador} | reasoning.effort ${config.llm_esfuerzo_razonamiento || '(vacío: se envía temperature)'} | reintentos JS-5 ${maxIntentos - 1} | tope USD ${args.topeUsd}`);

  // --- Acumuladores (SOLO agregados) ----------------------------------------
  const ag = {
    evaluadas: 0,
    sin_llamada_por_sin_mensajes_agente: 0,
    validas_al_final: 0,
    invalidas_tras_reintentos: 0,
    fallidas_api: 0,
    fallidas_pipeline: 0,
    intentos_llm: 0,
    respuestas_invalidas_js5: 0, // intentos cuya respuesta no pasó JS-5
    errores_js5_total: 0,
    errores_js5_por_tipo: {},
    // Diagnóstico de rechazos de regla 1 en la raíz (sección 12b): SOLO el
    // texto de JS-5 cuando es un mensaje fijo sin contenido
    // (js5.mensajeRaizSinContenido) y la forma de la salida de la API, sin
    // texto. Conteos sin ID de conversación ni orden.
    diagnostico_raiz: { mensajes_js5: {}, forma_salida: {}, tokens_salida_intentos_rechazados: [] },
    // Anomalías de la salida de la API (extraerTextoSalida de JS-5), en TODOS
    // los intentos, también los válidos: etiquetas fijas (por ejemplo
    // fase_commentary_ignorada), sin texto ni ID. Los caracteres y tokens de
    // salida de esos intentos van ordenados, sin orden de conversación.
    anomalias_salida: { intentos_con_anomalia: 0, por_tipo: {}, caracteres_ignorados: [], tokens_salida: [] },
    errores_api_por_tipo: {},
    errores_pipeline_por_tipo: {},
    tokens_entrada: 0,
    tokens_salida: 0,
    costo_usd: 0,
    comparadas: 0,
    criterios: { total: { coinciden: 0, total: 0 }, JS: { coinciden: 0, total: 0 }, LLM: { coinciden: 0, total: 0 }, HIBRIDO: { coinciden: 0, total: 0 } },
    criticos: { esperados: 0, detectados: 0, coincidencias: 0, falsos_positivos: 0, falsos_negativos: 0 },
    solo_llm: { total: 0, coinciden_con_esperado: 0, de_origen_LLM: 0, parte_LLM_de_HIBRIDO: 0 },
    suma_dif_abs_nota_final: 0,
  };
  let detenidoPorTope = false;
  let detenidoPorError = null;
  const falla = (c) => c.resultado === 'no_cumple' || c.resultado === 'detectado';

  for (let i = 0; i < seleccion.length && !detenidoPorTope && !detenidoPorError; i++) {
    const id = seleccion[i];
    const escenario = porId.get(id);
    try {
      const payload = JSON.parse(await readFile(path.join(carpeta, `${id}.json`), 'utf8'));
      const ctx = ayudas.contextoHastaJS3(payload, { lote: args.lote });
      const sinAgente = ctx.resultados_js.variables.sin_mensajes_agente;

      let llm = null;
      const intentosConsumo = [];
      let completada = true;
      if (sinAgente) {
        ag.sin_llamada_por_sin_mensajes_agente++;
      } else {
        // JS-4 con los parámetros de config (modelo, reasoning, claves del esquema).
        const mensajes = ctx.extraccion.mensajes_enmascarados;
        const datosValidacion = {
          esquema,
          mensajes,
          catalogo_temas: catalogo,
          base_conocimiento: base,
          tipo_interaccion: payload.tipo_interaccion,
          termina_por_inactividad: ctx.resultados_js.variables.termina_por_inactividad,
        };
        let cuerpo = js4.construirPeticion(
          { plantilla, esquema, mensajes, termina_por_inactividad: datosValidacion.termina_por_inactividad, catalogo_temas: catalogo, base_conocimiento: base, tipo_interaccion: payload.tipo_interaccion, config },
          { max_tokens_salida: MAX_OUTPUT_TOKENS }
        );
        let valida = false;
        for (let n = 1; n <= maxIntentos; n++) {
          if (!args.sinLlamada && ag.costo_usd >= args.topeUsd) {
            detenidoPorTope = true;
            completada = false;
            break;
          }
          let texto;
          let rechazo = false;
          let estado = null;
          let estructura = null;
          let fallaEstructura = null;
          let usoIntento = null;
          if (args.sinLlamada) {
            texto = JSON.stringify(llmSimulado(escenario, ctx));
            intentosConsumo.push({ tokens_entrada: 0, tokens_salida: 0 });
          } else {
            let respuestaHttp;
            try {
              respuestaHttp = await fetch(URL_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` }, // la clave solo viaja aquí
                body: JSON.stringify(cuerpo),
                signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
              });
            } catch (e) {
              sumarEn(ag.errores_api_por_tipo, 'red o tiempo agotado');
              ag.fallidas_api++;
              completada = false;
              break;
            }
            const json = await respuestaHttp.json().catch(() => null);
            if (!respuestaHttp.ok || !json) {
              sumarEn(ag.errores_api_por_tipo, `HTTP ${respuestaHttp.status}: ${String(json?.error?.message ?? 'respuesta no JSON').replace(/CONV-\d+/g, 'CONV-*').slice(0, 200)}`);
              ag.fallidas_api++;
              completada = false;
              // Errores de petición o credencial: se repetirían en todas; se detiene.
              if ([400, 401, 403, 404].includes(respuestaHttp.status)) detenidoPorError = `HTTP ${respuestaHttp.status}`;
              break;
            }
            const uso = js8.extraerUsoOpenAI(json);
            usoIntento = uso;
            intentosConsumo.push(uso);
            ag.tokens_entrada += uso.tokens_entrada;
            ag.tokens_salida += uso.tokens_salida;
            ag.costo_usd += js8.calcularCostoTokens(uso.tokens_entrada, uso.tokens_salida, config.precio_entrada_usd_millon_evaluador, config.precio_salida_usd_millon_evaluador) ?? 0;
            ({ texto, rechazo, estado, estructura, falla_estructura: fallaEstructura } = js5.extraerTextoSalida(json));
          }
          ag.intentos_llm++;
          registrarAnomaliasSalida(ag.anomalias_salida, estructura, usoIntento);

          // Salida ambigua de la API (dos final_answer, varios mensajes sin fase,
          // ningún final_answer, varias partes output_text): falla de API, sin
          // reintento de JS-5 (en W2: log_errores con tipo_error fallo_api).
          if (fallaEstructura) {
            sumarEn(ag.errores_api_por_tipo, `estructura_salida: ${fallaEstructura.causa}`);
            ag.fallidas_api++;
            completada = false;
            break;
          }

          // JS-5.
          const resultado = js5.validarRespuestaLlm(texto, datosValidacion);
          if (rechazo) resultado.detalle.unshift({ regla: 'refusal', ruta: '(raíz)', mensaje: 'El modelo se negó a responder (refusal).' });
          if (resultado.valido && !rechazo) {
            llm = JSON.parse(texto);
            valida = true;
            break;
          }
          ag.respuestas_invalidas_js5++;
          ag.errores_js5_total += resultado.detalle.length;
          for (const d of resultado.detalle) sumarEn(ag.errores_js5_por_tipo, tipoErrorJs5(d));
          registrarDiagnosticoRaiz(ag.diagnostico_raiz, resultado.detalle, js5, estado, estructura, usoIntento);
          if (n < maxIntentos) cuerpo = js4.agregarReintento(cuerpo, texto, js5.redactarMensajeReintento(resultado));
        }
        if (completada && !valida) {
          ag.invalidas_tras_reintentos++;
          completada = false;
        }
      }

      if (!completada) {
        // No se cuenta como evaluada (en W2 iría a log_errores o se detuvo por tope).
        console.log(`  procesadas ${i + 1}/${seleccion.length}`);
        continue;
      }

      // JS-6..JS-8 con la salida validada (o null si no hay mensajes del agente).
      const { evaluacion } = ayudas.evaluar(payload, llm, { lote: args.lote, intentos: intentosConsumo });
      ag.evaluadas++;
      if (!sinAgente) ag.validas_al_final++;

      // Comparación contra el escenario (misma regla que lote_calibracion_v1.test.js).
      const fallar = new Set(separar(escenario.criterios_que_deben_fallar));
      const criticosEsperados = new Set(separar(escenario.errores_criticos_inyectados));
      for (const c of evaluacion.criterios) {
        const esperado = c.tipo_criterio === 'critico' ? criticosEsperados.has(c.id_criterio) : fallar.has(c.id_criterio);
        const coincide = falla(c) === esperado;
        for (const k of ['total', c.origen]) {
          ag.criterios[k].total++;
          if (coincide) ag.criterios[k].coinciden++;
        }
        if (c.tipo_criterio === 'critico') {
          if (esperado) ag.criticos.esperados++;
          if (falla(c)) ag.criticos.detectados++;
          if (esperado && falla(c)) ag.criticos.coincidencias++;
          if (!esperado && falla(c)) ag.criticos.falsos_positivos++;
          if (esperado && !falla(c)) ag.criticos.falsos_negativos++;
        }
      }
      ag.suma_dif_abs_nota_final += Math.abs(evaluacion.nota_final - escenario.nota_esperada.nota_final);
      ag.comparadas++;

      // Críticos solo-LLM: detectados que desaparecen al neutralizar criticos_posibles.
      if (llm) {
        const { evaluacion: sinLlm } = ayudas.evaluar(payload, sinCriticosLlm(llm), { lote: args.lote, intentos: intentosConsumo });
        const detectadosSinLlm = new Set(sinLlm.criterios.filter((c) => c.tipo_criterio === 'critico' && c.resultado === 'detectado').map((c) => c.id_criterio));
        for (const c of evaluacion.criterios) {
          if (c.tipo_criterio !== 'critico' || c.resultado !== 'detectado' || detectadosSinLlm.has(c.id_criterio)) continue;
          ag.solo_llm.total++;
          if (criticosEsperados.has(c.id_criterio)) ag.solo_llm.coinciden_con_esperado++;
          if (c.origen === 'LLM') ag.solo_llm.de_origen_LLM++;
          else ag.solo_llm.parte_LLM_de_HIBRIDO++;
        }
      }
    } catch (e) {
      ag.fallidas_pipeline++;
      sumarEn(ag.errores_pipeline_por_tipo, tipoExcepcion(e));
    }
    console.log(`  procesadas ${i + 1}/${seleccion.length}`);
  }

  // --- Resultado agregado ---------------------------------------------------
  const resultados = {
    fecha_ejecucion: new Date().toISOString(),
    node: process.version,
    modo,
    lote: args.lote,
    seleccion: criterioSeleccion,
    version_prompt: config.version_prompt,
    version_reglas: config.version_reglas,
    parametros: {
      modelo: config.modelo_evaluador,
      reasoning_effort: config.llm_esfuerzo_razonamiento || null,
      temperature: config.llm_esfuerzo_razonamiento ? '(no enviado)' : config.llm_temperatura,
      claves_esquema_excluidas: config.claves_esquema_excluidas_evaluador ?? [],
      reintentos_validacion_llm: maxIntentos - 1,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      tope_usd: args.topeUsd,
      precios_usd_millon: { entrada: config.precio_entrada_usd_millon_evaluador, salida: config.precio_salida_usd_millon_evaluador },
    },
    ejecucion: {
      conversaciones_solicitadas: seleccion.length,
      conversaciones_evaluadas: ag.evaluadas,
      sin_llamada_por_sin_mensajes_agente: ag.sin_llamada_por_sin_mensajes_agente,
      respuestas_validas_al_final: ag.validas_al_final,
      invalidas_tras_reintentos: ag.invalidas_tras_reintentos,
      fallidas_api: ag.fallidas_api,
      fallidas_pipeline: ag.fallidas_pipeline,
      detenido_por_tope: detenidoPorTope,
      detenido_por_error_api: detenidoPorError,
      intentos_llm_totales: ag.intentos_llm,
      respuestas_rechazadas_por_js5: ag.respuestas_invalidas_js5,
      errores_js5_total: ag.errores_js5_total,
      errores_js5_por_tipo: ag.errores_js5_por_tipo,
      diagnostico_raiz: ag.diagnostico_raiz,
      anomalias_salida: ag.anomalias_salida,
      errores_api_por_tipo: ag.errores_api_por_tipo,
      errores_pipeline_por_tipo: ag.errores_pipeline_por_tipo,
    },
    consumo: {
      tokens_entrada: ag.tokens_entrada,
      tokens_salida: ag.tokens_salida,
      tokens_totales: ag.tokens_entrada + ag.tokens_salida,
      costo_total_usd: Number(ag.costo_usd.toFixed(6)),
      costo_promedio_por_evaluacion_usd: ag.evaluadas - ag.sin_llamada_por_sin_mensajes_agente > 0 ? Number((ag.costo_usd / (ag.evaluadas - ag.sin_llamada_por_sin_mensajes_agente)).toFixed(6)) : null,
    },
    concordancia_con_escenario: {
      conversaciones_comparadas: ag.comparadas,
      criterios_coincidentes_pct: Object.fromEntries(
        Object.entries(ag.criterios).map(([k, v]) => [k, { pct: porcentaje(v.coinciden, v.total), coinciden: v.coinciden, total: v.total }])
      ),
      criticos: ag.criticos,
      diferencia_promedio_absoluta_nota_final: ag.comparadas ? Number((ag.suma_dif_abs_nota_final / ag.comparadas).toFixed(2)) : null,
      criticos_solo_llm: ag.solo_llm,
    },
    notas: [
      'Salida solo agregada: no hay resultados por conversación (regla del dueño, calificación humana a ciegas).',
      'Lo esperado sale de _escenarios.json (intención del generador), no de la calificación humana: no es una métrica de calibración.',
      'diagnostico.numero_preguntas se incluye en la comparación (con el LLM real ya no depende de una simulación).',
      'Críticos solo-LLM: detectados que dejan de detectarse al volver a correr JS-6..JS-7 con criticos_posibles neutralizados.',
      'costo_promedio_por_evaluacion_usd = costo total (incluye intentos de conversaciones que no terminaron) / evaluaciones completadas con llamada al LLM.',
    ],
  };

  console.log('\n===== RESUMEN PRUEBA B (LOTE, SOLO AGREGADOS) =====');
  console.log(JSON.stringify({ ejecucion: resultados.ejecucion, consumo: resultados.consumo, concordancia_con_escenario: resultados.concordancia_con_escenario }, null, 2));
  if (detenidoPorTope) console.log(`DETENIDO POR TOPE: el costo acumulado alcanzó USD ${args.topeUsd}.`);
  if (detenidoPorError) console.log(`DETENIDO POR ERROR DE LA API (${detenidoPorError}); ver errores_api_por_tipo.`);
  if (args.sinLlamada) {
    console.log('--sin-llamada: LLM simulado; no se llamó a la API ni se escribió resultados_prueba_b_lote_<fecha-hora>.json.');
    return;
  }
  await mkdir(CARPETA_PRIVADA, { recursive: true });
  await writeFile(RUTA_RESULTADOS_B_LOTE, JSON.stringify(resultados, null, 2) + '\n', 'utf8');
  console.log(`Resultados guardados en ${path.relative(RAIZ_REPO, RUTA_RESULTADOS_B_LOTE)}`);
}

// -----------------------------------------------------------------------------
// 13. Programa principal.
// -----------------------------------------------------------------------------
async function main() {
  const args = leerArgumentos(process.argv.slice(2));

  if (args.pruebaB && args.lote) {
    await pruebaBLote(args);
    return;
  }
  if (args.pruebaB) {
    await pruebaB(args);
    return;
  }

  // La clave se lee del entorno (cargada con --env-file=.env).
  const clave = process.env.OPENAI_API_KEY;
  if (!clave || clave.trim() === '') {
    console.error(
      'Falta OPENAI_API_KEY. Crea un archivo .env en la raíz del repositorio con la línea\n' +
        '  OPENAI_API_KEY=tu_clave\n' +
        'y ejecuta: node --env-file=.env prompts/verificacion/verificar_openai.mjs'
    );
    process.exit(1);
  }

  console.log(`Prueba A con modelo ${args.modelo}`);
  if (args.modelo !== MODELO_DEFAULT) {
    console.log(`AVISO: los precios usados son los de ${MODELO_DEFAULT}; el costo mostrado no aplica a ${args.modelo}.`);
  }

  const { intentos, conclusion, costoTotal } = await pruebaA(clave, args.modelo);

  // Archivo de resultados: solo lo observado. Sin clave ni respuesta completa.
  const resultados = {
    fecha_ejecucion: new Date().toISOString(),
    node: process.version,
    modelo_solicitado: args.modelo,
    precios_usd_millon: {
      modelo: MODELO_DEFAULT,
      entrada: PRECIO_ENTRADA_USD_MILLON,
      salida: PRECIO_SALIDA_USD_MILLON,
      fuente: 'developers.openai.com, verificado por el orquestador el 22-oct-2026',
    },
    conclusion,
    costo_total_usd: Number(costoTotal.toFixed(6)),
    intentos,
  };
  await writeFile(RUTA_RESULTADOS, JSON.stringify(resultados, null, 2) + '\n', 'utf8');

  // Resumen en consola.
  console.log('\n===== RESUMEN PRUEBA A =====');
  console.log(`Intentos: ${intentos.length}`);
  if (conclusion.aceptado) {
    console.log(`Aceptado con: ${conclusion.parametros_aceptados} | ${conclusion.variante_esquema_aceptada}`);
    console.log(`Claves que hubo que quitar del esquema: ${conclusion.claves_que_hubo_que_quitar.join(', ') || 'ninguna'}`);
  } else {
    console.log(`No se logró una petición aceptada: ${conclusion.motivo_detencion}`);
  }
  for (const r of conclusion.rechazos_observados) {
    console.log(
      `  Rechazo intento ${r.intento} (HTTP ${r.http_status}, ${r.categoria}; claves en el error: ` +
        `${r.claves_mencionadas_en_error.join(', ') || 'ninguna'}): ${r.mensaje_literal}`
    );
  }
  console.log(`Costo total estimado: USD ${costoTotal.toFixed(6)} (precios de ${MODELO_DEFAULT})`);
  console.log(`Resultados guardados en ${path.relative(RAIZ_REPO, RUTA_RESULTADOS)}`);
}

main().catch((e) => {
  // Error inesperado del script (no de la API). No incluye la clave.
  console.error('Error inesperado:', e?.message ?? e);
  process.exit(1);
});
