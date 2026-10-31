// =============================================================================
// construccion_prompt.js  (JS-4 del Workflow 2: Evaluación)
// -----------------------------------------------------------------------------
// Dueño: subagente evaluador-llm.
//
// Qué hace: arma el cuerpo de la petición a la API Responses de OpenAI para
// evaluar UNA conversación:
//   - instructions: el bloque de instrucciones del prompt versionado
//     (prompts/evaluador_ce_v1.md, entre INICIO_INSTRUCCIONES y FIN_INSTRUCCIONES);
//   - input: un mensaje "user" con el catálogo de temas, la base de conocimiento
//     completa (decisión D3), la bandera termina_por_inactividad y la
//     conversación enmascarada con mensajes numerados;
//   - text.format: salida estructurada estricta con contrato/llm_output.schema.json.
//
// Qué NO hace: no enmascara (eso es JS-2, de reglas-js), no llama a la API (eso
// es el nodo HTTP Request de n8n), no valida la respuesta (eso es JS-5,
// js/validador_llm.js) y no calcula nada de la nota.
//
// Principio: funciones puras. Reciben datos y devuelven datos nuevos; no leen
// archivos ni variables globales. Así se prueban con Node y se pegan tal cual
// en un nodo Code de n8n (ver bloque comentado al final).
//
// Forma de los datos de entrada (solo lo documentado en contrato/):
//   - mensajes: arreglo de { n, emisor, texto } (timestamp se ignora) con el
//     texto YA enmascarado por JS-2 ([EMAIL_n], [RFC_n], [TELEFONO_n], [NOMBRE_n]).
//     Son los mismos campos de payload.schema.json (mensajes[]).
//   - catalogo_temas / base_conocimiento: filas de las hojas, con las columnas
//     de contrato/sheets.md (tema, id_articulo, tipo_interaccion, activo, ...).
//   - config: objeto clave -> valor ya resuelto para el tipo_interaccion
//     (precedencia del tipo sobre "todos", contrato/config.md sección 0).
// =============================================================================

'use strict';

// -----------------------------------------------------------------------------
// 1. Plantilla versionada
// -----------------------------------------------------------------------------

// Devuelve el texto entre <!-- INICIO_<NOMBRE> --> y <!-- FIN_<NOMBRE> -->.
// Lanza un error si falta alguno de los dos delimitadores: un prompt mal pegado
// en n8n debe detener la evaluación, no mandar un prompt vacío al modelo.
function extraerBloque(textoPlantilla, nombre) {
  const inicio = `<!-- INICIO_${nombre} -->`;
  const fin = `<!-- FIN_${nombre} -->`;
  const i = textoPlantilla.indexOf(inicio);
  const f = textoPlantilla.indexOf(fin);
  if (i === -1 || f === -1 || f < i) {
    throw new Error(`La plantilla del prompt no tiene el bloque ${nombre} completo (faltan los delimitadores ${inicio} / ${fin}).`);
  }
  return textoPlantilla.slice(i + inicio.length, f).trim();
}

// Separa la plantilla en sus dos bloques y verifica que corresponda a la versión
// configurada. La primera línea del archivo es el título y contiene la versión
// (por ejemplo "# Prompt del evaluador CE — `evaluador_ce_v1`"). Si config dice
// evaluador_ce_v2 pero se pegó el texto de v1, se detiene: así nunca se guarda
// una evaluación con una version_prompt que no corresponde al texto usado.
function leerPlantilla(textoPlantilla, versionEsperada) {
  if (typeof textoPlantilla !== 'string' || textoPlantilla.trim() === '') {
    throw new Error('La plantilla del prompt está vacía.');
  }
  // Normaliza saltos de línea de Windows para que los delimitadores coincidan.
  const texto = textoPlantilla.replace(/\r\n/g, '\n');
  if (versionEsperada) {
    const primeraLinea = texto.split('\n', 1)[0];
    // Comparación por palabra completa: evita que evaluador_ce_v1 coincida con evaluador_ce_v10.
    const patron = new RegExp(`(^|[^a-z0-9_])${versionEsperada}([^a-z0-9_]|$)`);
    if (!patron.test(primeraLinea)) {
      throw new Error(`La plantilla pegada no corresponde a ${versionEsperada}. Primera línea: "${primeraLinea}".`);
    }
  }
  return {
    instrucciones: extraerBloque(texto, 'INSTRUCCIONES'),
    plantilla_entrada: extraerBloque(texto, 'ENTRADA'),
  };
}

// -----------------------------------------------------------------------------
// 2. Filtros de las hojas de referencia
// -----------------------------------------------------------------------------

// Filas del tipo de la conversación UNIDAS a las de "todos" (contrato/config.md
// sección 0: en catalogo_temas y base_conocimiento no hay precedencia).
function filtrarPorTipo(filas, tipoInteraccion) {
  return (filas || []).filter((f) => f && (f.tipo_interaccion === tipoInteraccion || f.tipo_interaccion === 'todos'));
}

// En Sheets los booleanos son "si"/"no" (glosario, sección 1). Se acepta también
// true por si la fila ya viene convertida.
function esActivo(fila) {
  return fila.activo === 'si' || fila.activo === true;
}

// Catálogo que ve el modelo: un tema por línea, sin repetir, con su(s)
// artículo(s) principal(es). No se muestran tipificaciones válidas ni
// requiere_escalamiento: el modelo clasifica el tema y JS compara después.
function formatearCatalogo(catalogoTemas, tipoInteraccion) {
  const activos = filtrarPorTipo(catalogoTemas, tipoInteraccion).filter(esActivo);
  const articulosPorTema = new Map();
  for (const fila of activos) {
    if (!articulosPorTema.has(fila.tema)) articulosPorTema.set(fila.tema, new Set());
    if (fila.id_articulo) articulosPorTema.get(fila.tema).add(fila.id_articulo);
  }
  if (articulosPorTema.size === 0) {
    throw new Error(`No hay temas activos en catalogo_temas para tipo_interaccion ${tipoInteraccion}.`);
  }
  const lineas = [];
  for (const [tema, articulos] of articulosPorTema) {
    const lista = [...articulos].sort().join(', ');
    lineas.push(lista ? `- ${tema} (artículo principal: ${lista})` : `- ${tema}`);
  }
  return lineas.join('\n');
}

// Un artículo de la base, con el mismo formato que usa el evaluador. Una celda
// vacía se muestra como "(sin información)" para que el modelo no confunda "no
// hay casos de escalamiento" con "no me dieron esa parte". Lo usan
// formatearBaseConocimiento() (evaluador y generador) y articuloDelTema()
// (generador v3), así el artículo del tema se ve igual que en la base completa.
function formatearArticulo(a) {
  const celda = (v) => (v === undefined || v === null || String(v).trim() === '' ? '(sin información)' : String(v).trim());
  return [
    `## ${a.id_articulo} | ${celda(a.titulo)}`,
    `Tema: ${celda(a.tema)}`,
    `Contenido: ${celda(a.contenido)}`,
    `Plazos: ${celda(a.plazos)}`,
    `Casos de escalamiento: ${celda(a.casos_escalamiento)}`,
    `Promociones autorizadas: ${celda(a.promociones_autorizadas)}`,
  ].join('\n');
}

// Base de conocimiento completa (D3), ordenada por id_articulo.
function formatearBaseConocimiento(baseConocimiento, tipoInteraccion) {
  const filas = filtrarPorTipo(baseConocimiento, tipoInteraccion)
    .slice()
    .sort((a, b) => String(a.id_articulo).localeCompare(String(b.id_articulo)));
  if (filas.length === 0) {
    throw new Error(`No hay artículos en base_conocimiento para tipo_interaccion ${tipoInteraccion}.`);
  }
  return filas.map(formatearArticulo).join('\n\n');
}

// -----------------------------------------------------------------------------
// 3. Conversación numerada
// -----------------------------------------------------------------------------

// Formato: "[n] emisor: texto". No se incluyen timestamps a propósito: los
// tiempos los evalúa JS, y mostrarlos invitaría al modelo a juzgar esperas.
// Los saltos de línea dentro de un mensaje se conservan con sangría, para que
// el modelo no confunda una línea nueva con un mensaje nuevo.
function formatearConversacion(mensajes) {
  if (!Array.isArray(mensajes) || mensajes.length === 0) {
    throw new Error('La conversación no tiene mensajes.');
  }
  const ordenados = mensajes.slice().sort((a, b) => a.n - b.n);
  for (const m of ordenados) {
    if (!Number.isInteger(m.n) || m.n < 1) throw new Error(`Mensaje con número inválido: ${JSON.stringify(m.n)}.`);
    if (m.emisor !== 'agente' && m.emisor !== 'cliente') throw new Error(`Mensaje ${m.n} con emisor inválido: ${m.emisor}.`);
    if (typeof m.texto !== 'string') throw new Error(`Mensaje ${m.n} sin texto.`);
  }
  if (!ordenados.some((m) => m.emisor === 'agente')) {
    // rubrica.md 3.12: sin mensajes del agente NO se llama al LLM. W2 debe
    // desviar antes de JS-4; si llega aquí es un error de flujo.
    throw new Error('La conversación no tiene mensajes del agente: no se llama al LLM (rubrica.md 3.12).');
  }
  return ordenados
    .map((m) => `[${m.n}] ${m.emisor}: ${m.texto.replace(/\r\n/g, '\n').split('\n').join('\n    ')}`)
    .join('\n');
}

// Reemplaza los marcadores <<NOMBRE>> de la plantilla de entrada. Se usa
// split/join en lugar de replace para que un "$" dentro de la conversación no
// se interprete como patrón especial de reemplazo.
function llenarPlantillaEntrada(plantillaEntrada, valores) {
  let texto = plantillaEntrada;
  for (const [marcador, valor] of Object.entries(valores)) {
    const token = `<<${marcador}>>`;
    if (!texto.includes(token)) throw new Error(`La plantilla de entrada no contiene el marcador ${token}.`);
    texto = texto.split(token).join(String(valor));
  }
  const sobrante = texto.match(/<<[A-Z_]+>>/);
  if (sobrante) throw new Error(`La plantilla de entrada tiene un marcador sin llenar: ${sobrante[0]}.`);
  return texto;
}

// -----------------------------------------------------------------------------
// 4. Limpieza del esquema (resultado de la prueba A)
// -----------------------------------------------------------------------------
// La prueba A del 23-oct-2026 (prompts/verificacion/verificar_openai.mjs) mostró
// que gpt-6-luna acepta el esquema tal cual, así que por defecto no se quita
// nada (config.claves_esquema_excluidas_evaluador vacía). Si un modelo futuro
// rechaza alguna clave, se agrega a esa lista de config y se quita aquí, SIN
// tocar el archivo del contrato. La validación completa se conserva en JS-5,
// que siempre valida contra el esquema original.
//
// clavesNoAceptadas: lista de textos (vacía por defecto). Dos formas:
//   "title"                                     -> quita la palabra clave en todo el esquema
//   "minimum@primer_mensaje_info_cuenta.mensaje_n" -> solo en esa propiedad
// La ruta usa nombres de propiedades separados por punto; los arreglos se
// atraviesan sin escribir "items" (solicitudes_cliente.mensaje_n).
//
// Importante: solo se quitan PALABRAS CLAVE de JSON Schema, nunca nombres de
// propiedades. Si algún día un campo se llamara "title", no se borraría.
function limpiarEsquema(esquema, clavesNoAceptadas = []) {
  const copia = JSON.parse(JSON.stringify(esquema)); // copia profunda, el original no cambia
  const globales = new Set();
  const porRuta = []; // { clave, ruta }
  for (const entrada of clavesNoAceptadas) {
    const [clave, ruta] = String(entrada).split('@');
    if (ruta) porRuta.push({ clave, ruta });
    else globales.add(clave);
  }

  function recorrer(nodo, ruta) {
    if (!nodo || typeof nodo !== 'object' || Array.isArray(nodo)) return;
    for (const clave of globales) delete nodo[clave];
    for (const r of porRuta) if (r.ruta === ruta) delete nodo[r.clave];

    if (nodo.properties && typeof nodo.properties === 'object') {
      for (const [nombre, sub] of Object.entries(nodo.properties)) {
        recorrer(sub, ruta ? `${ruta}.${nombre}` : nombre);
      }
    }
    if (nodo.items) recorrer(nodo.items, ruta); // los arreglos no agregan segmento a la ruta
    for (const k of ['anyOf', 'allOf', 'oneOf']) {
      if (Array.isArray(nodo[k])) nodo[k].forEach((sub) => recorrer(sub, ruta));
    }
    for (const k of ['$defs', 'definitions']) {
      if (nodo[k] && typeof nodo[k] === 'object') {
        for (const sub of Object.values(nodo[k])) recorrer(sub, '');
      }
    }
    if (nodo.additionalProperties && typeof nodo.additionalProperties === 'object') {
      recorrer(nodo.additionalProperties, ruta);
    }
  }

  recorrer(copia, '');
  return copia;
}

// Lee una clave de config de tipo "lista". JS-1 (normalizacion.js) ya la
// entrega como arreglo; si llega como texto crudo de Sheets ("a|b"), se separa
// aquí. Celda vacía, null o ausente -> lista vacía.
function leerListaConfig(valor) {
  if (Array.isArray(valor)) return valor.map((v) => String(v).trim()).filter((v) => v !== '');
  if (valor === undefined || valor === null) return [];
  return String(valor)
    .split('|')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

// Lee una clave de config de tipo "entero" que debe ser > 0. JS-1
// (normalizacion.js) ya la entrega como número; si llega como texto crudo de
// Sheets ("8000"), se acepta solo si son dígitos. "8000.5", "0", "", null o
// ausente -> error explícito con el nombre de la clave.
function leerEnteroPositivo(valor, nombre) {
  let n = NaN;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'string' && /^\s*\d+\s*$/.test(valor)) n = Number(valor);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${nombre} debe ser un entero positivo y vale ${JSON.stringify(valor)}.`);
  }
  return n;
}

// -----------------------------------------------------------------------------
// 5. Parámetros de muestreo
// -----------------------------------------------------------------------------
// Decisión del dueño: temperatura 0 (config.llm_temperatura). La prueba A del
// 23-oct-2026 mostró que gpt-6-luna rechaza temperature y acepta
// reasoning.effort "none". Regla (contrato/config.md, sección 8):
//   - si config.llm_esfuerzo_razonamiento tiene valor -> { reasoning: { effort } }
//     y NO se envía temperature;
//   - si está vacía -> { temperature: config.llm_temperatura }.
// opciones.esfuerzo_razonamiento, si se da (incluido ''), tiene precedencia
// sobre config; sirve para pruebas. En producción no se pasa.
function parametrosMuestreo(config, opciones = {}) {
  const esfuerzo = opciones.esfuerzo_razonamiento !== undefined ? opciones.esfuerzo_razonamiento : config.llm_esfuerzo_razonamiento;
  if (esfuerzo !== null && esfuerzo !== undefined && String(esfuerzo).trim() !== '') {
    return { reasoning: { effort: String(esfuerzo) } }; // sin temperature
  }
  const temperatura = Number(config.llm_temperatura);
  if (!Number.isFinite(temperatura)) {
    throw new Error(`config.llm_temperatura no es un número: ${JSON.stringify(config.llm_temperatura)}.`);
  }
  return { temperature: temperatura };
}

// -----------------------------------------------------------------------------
// 6. Petición completa
// -----------------------------------------------------------------------------
// datos = {
//   plantilla,               // texto completo de prompts/evaluador_<tipo>_vN.md
//   esquema,                 // contrato/llm_output.schema.json (objeto)
//   mensajes,                // salida enmascarada de JS-2: [{ n, emisor, texto }]
//   termina_por_inactividad, // booleano calculado por JS (rubrica.md 3.10)
//   catalogo_temas,          // filas de la hoja catalogo_temas
//   base_conocimiento,       // filas de la hoja base_conocimiento
//   tipo_interaccion,        // "ce"
//   config,                  // claves ya resueltas para el tipo
// }
// opciones = {   // todas opcionales; en producción basta con config
//   claves_esquema_no_aceptadas, // si se da, sustituye a config.claves_esquema_excluidas_evaluador
//   esfuerzo_razonamiento,       // si se da, sustituye a config.llm_esfuerzo_razonamiento
//   max_tokens_salida,           // si se da, sustituye al VALOR de config.max_tokens_evaluador
// }
//
// Tope de salida (Fase 2, 24-oct-2026; contrato/config.md sección 8):
//   - SIEMPRE se envía max_output_tokens. Sale de config.max_tokens_evaluador
//     (entero, 8000). Si la clave falta o no es un entero positivo, se lanza un
//     error explícito: sin tope, una respuesta desbocada (por ejemplo, con el
//     bloque commentary) no tendría límite de costo.
//   - Decisión: opciones.max_tokens_salida se CONSERVA como override solo para
//     pruebas y para prompts/verificacion/verificar_openai.mjs (pruebas A y B).
//     Aun con override, config.max_tokens_evaluador se valida igual: así una
//     hoja config sin la clave falla también en las pruebas y no solo en n8n.
//     En producción (nodo de n8n) no se pasa.
//   - Esto NO cambia el texto del prompt: evaluador_ce_v1 no sube de versión.
//     El valor 8000 es el mismo tope que se usó en la prueba B, así que las
//     evaluaciones de v1 se hacen con las mismas condiciones que se midieron.
// Devuelve el objeto que el nodo HTTP Request envía como cuerpo JSON a
// POST https://api.openai.com/v1/responses.
function construirPeticion(datos, opciones = {}) {
  const { plantilla, esquema, mensajes, termina_por_inactividad, catalogo_temas, base_conocimiento, tipo_interaccion, config } = datos;
  if (!config) throw new Error('Falta config.');
  if (typeof termina_por_inactividad !== 'boolean') {
    throw new Error('termina_por_inactividad debe ser booleano (lo calcula JS antes de JS-4).');
  }
  const modelo = config.modelo_evaluador;
  if (!modelo || modelo === 'por_verificar') {
    throw new Error('config.modelo_evaluador no está definido (sigue en por_verificar): no se puede llamar al evaluador.');
  }
  if (!esquema || typeof esquema !== 'object') throw new Error('Falta el esquema de salida.');

  const { instrucciones, plantilla_entrada } = leerPlantilla(plantilla, config.version_prompt);
  const entrada = llenarPlantillaEntrada(plantilla_entrada, {
    CATALOGO_TEMAS: formatearCatalogo(catalogo_temas, tipo_interaccion),
    BASE_CONOCIMIENTO: formatearBaseConocimiento(base_conocimiento, tipo_interaccion),
    TERMINA_POR_INACTIVIDAD: termina_por_inactividad ? 'true' : 'false',
    CONVERSACION: formatearConversacion(mensajes),
  });

  const cuerpo = {
    model: modelo,
    instructions: instrucciones,
    input: [{ role: 'user', content: entrada }],
    text: {
      format: {
        type: 'json_schema',
        name: `evaluacion_${tipo_interaccion}`,
        strict: true,
        schema: limpiarEsquema(
          esquema,
          opciones.claves_esquema_no_aceptadas !== undefined
            ? leerListaConfig(opciones.claves_esquema_no_aceptadas)
            : leerListaConfig(config.claves_esquema_excluidas_evaluador)
        ),
      },
    },
    store: false, // no guardar la conversación en OpenAI
    ...parametrosMuestreo(config, opciones),
  };
  const topeConfig = leerEnteroPositivo(config.max_tokens_evaluador, 'config.max_tokens_evaluador');
  cuerpo.max_output_tokens =
    opciones.max_tokens_salida !== undefined ? leerEnteroPositivo(opciones.max_tokens_salida, 'opciones.max_tokens_salida') : topeConfig;
  return cuerpo;
}

// -----------------------------------------------------------------------------
// 7. Reintento por respuesta inválida (Workflow 2, paso 7)
// -----------------------------------------------------------------------------
// Devuelve una petición NUEVA (no modifica la original) con la conversación
// previa: la respuesta anterior del modelo como "assistant" y los errores de
// JS-5 como "user". mensajeErrores sale de redactarMensajeReintento() de
// js/validador_llm.js.
function agregarReintento(cuerpo, textoRespuestaAnterior, mensajeErrores) {
  const nuevo = JSON.parse(JSON.stringify(cuerpo));
  nuevo.input.push({ role: 'assistant', content: String(textoRespuestaAnterior ?? '') });
  nuevo.input.push({ role: 'user', content: String(mensajeErrores) });
  return nuevo;
}

// -----------------------------------------------------------------------------
// 8. Generador del simulador (Workflow 0, pasos 3 y 4) — Anthropic Messages API
// -----------------------------------------------------------------------------
// Fuente verificada el 24-oct-2026 (documentación oficial):
//   - platform.claude.com/docs/en/build-with-claude/structured-outputs.md
//     * claude-haiku-5-5 está en la lista de modelos con salida estructurada.
//     * La salida estructurada va en output_config.format = { type: "json_schema",
//       schema }. El parámetro output_format está OBSOLETO (sin el encabezado
//       beta structured-outputs-2025-11-13 devuelve 400): no se usa.
//     * Objetos con additionalProperties: false; no se admiten minimum/maximum,
//       minLength/maxLength ni minItems > 1 (400). El prefill es incompatible
//       con la salida JSON: no se manda ningún mensaje "assistant".
//     * stop_reason "refusal" (HTTP 200, se cobra) o "max_tokens": la salida
//       puede no cumplir el esquema.
//   - platform.claude.com/docs/en/api/messages.md y api/versioning.md
//     * Con anthropic-version 2026-10-21, temperature, top_p y top_k fueron
//       eliminados: enviarlos da 400 en todos los modelos. No se envían.
//     * max_tokens es obligatorio. Sale de config.max_tokens_generador.
//     * output_config admite effort y format en el mismo objeto (OutputConfig:
//       effort low|medium|high|xhigh|max, format json_schema). Según
//       build-with-claude/effort.md, claude-haiku-5-5 acepta los cinco niveles
//       y su valor por defecto es medium. Sale de config.esfuerzo_generador
//       (decisión del dueño, 24-oct-2026). thinking NO se envía: queda el
//       razonamiento adaptativo por defecto, cuya profundidad controla effort.
//     * El texto está en content[] -> bloque type "text". claude-haiku-5-5
//       tiene razonamiento adaptativo encendido por defecto (docs
//       build-with-claude/thinking.md): pueden llegar bloques type "thinking"
//       antes del texto; se ignoran. Sus tokens se cobran como salida y cuentan
//       dentro de max_tokens.
//     * usage.input_tokens / output_tokens. El total de entrada es
//       input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
//       output_tokens ya incluye los tokens de razonamiento.
//
// Encabezados del nodo HTTP Request (los fija workflows-n8n, no van en el cuerpo):
//   POST https://api.anthropic.com/v1/messages
//   x-api-key: <credencial de n8n>  (la API también acepta Authorization: Bearer)
//   anthropic-version: config.anthropic_version_api (2026-10-21; ver api/versioning.md)
//   content-type: application/json
//
// La versión del prompt sale de config.version_prompt_generador (generador_ce_v3
// desde el 30-oct-2026; generador_ce_v1 y generador_ce_v2 siguen funcionando si
// config apunta a ellas). leerPlantilla() detiene el nodo si el texto pegado no
// es de esa versión. Solo se envían los bloques INSTRUCCIONES (system) y ENTRADA
// (único mensaje user). El bloque GUIA_FALLAS de v3 NO se envía completo:
// guiaFallas() copia solo las líneas de los criterios pedidos.

// Valores de output_config.effort que documenta la Messages API (OutputConfig).
const ESFUERZOS_GENERADOR = ['low', 'medium', 'high', 'xhigh', 'max'];

// datos = {
//   plantilla, // texto completo de prompts/generador_ce_vN.md (N según config)
//   esquema,   // prompts/generador_payload_salida.schema.json (objeto)
//   valores,   // { CONVERSATION_ID: ..., CUENTA: ..., ... } todos los marcadores <<...>>
//              // de la plantilla (13 en v1, 15 en v2, 17 en v3; ver valoresGenerador)
//   config,    // claves ya resueltas para el tipo (modelo_generador,
//              // version_prompt_generador, max_tokens_generador, esfuerzo_generador)
// }
// Devuelve el cuerpo JSON para POST https://api.anthropic.com/v1/messages.
function construirPeticionGenerador(datos) {
  const { plantilla, esquema, valores, config } = datos || {};
  if (!config) throw new Error('Falta config.');
  const modelo = config.modelo_generador;
  if (!modelo || modelo === 'por_verificar') {
    throw new Error('config.modelo_generador no está definido (sigue en por_verificar): no se puede llamar al generador.');
  }
  const version = config.version_prompt_generador;
  if (!version || version === 'sin_rubrica') {
    throw new Error(`config.version_prompt_generador no tiene un prompt de generador: ${JSON.stringify(version)}.`);
  }
  const maxTokens = leerEnteroPositivo(config.max_tokens_generador, 'config.max_tokens_generador');
  const esfuerzo = config.esfuerzo_generador;
  if (!ESFUERZOS_GENERADOR.includes(esfuerzo)) {
    throw new Error(`config.esfuerzo_generador debe ser uno de ${ESFUERZOS_GENERADOR.join('|')} y vale ${JSON.stringify(esfuerzo)}.`);
  }
  if (!esquema || typeof esquema !== 'object' || Array.isArray(esquema)) throw new Error('Falta el esquema de salida del generador.');
  if (!valores || typeof valores !== 'object') throw new Error('Faltan los valores de los marcadores del generador.');

  const { instrucciones, plantilla_entrada } = leerPlantilla(plantilla, version);
  const entrada = llenarPlantillaEntrada(plantilla_entrada, valores);

  // Sin temperature, top_p, top_k ni thinking (razonamiento adaptativo por defecto).
  return {
    model: String(modelo),
    max_tokens: maxTokens,
    system: instrucciones,
    messages: [{ role: 'user', content: entrada }],
    output_config: {
      effort: esfuerzo,
      format: {
        type: 'json_schema',
        schema: JSON.parse(JSON.stringify(esquema)), // copia: el original no cambia
      },
    },
  };
}

// Marcadores nuevos de generador_ce_v2 a partir de extras de completarEscenario
// (js/simulador.js, reglas-js):
//   TIPIFICACION_AGENTE = extras.tipificacion_agente_prevista; si es null (sin
//                         critico.tipificacion_incorrecta), la tipificación esperada.
//   VARIANTE_IDENTIDAD  = 'datos_coinciden_sin_critico' si
//                         extras.variante_datos_coinciden_sin_critico es true; si no, 'ninguna'.
// Así el pegamento de W0 no decide nada: solo une estos valores con los demás.
function valoresExtrasGenerador(extras, tipificacionEsperada) {
  if (!extras || typeof extras !== 'object') throw new Error('Faltan los extras de completarEscenario.');
  if (typeof tipificacionEsperada !== 'string' || tipificacionEsperada.trim() === '') throw new Error('Falta la tipificación esperada.');
  const prevista = extras.tipificacion_agente_prevista;
  if (prevista !== null && prevista !== undefined && (typeof prevista !== 'string' || prevista.trim() === '')) {
    throw new Error(`extras.tipificacion_agente_prevista debe ser texto o null y vale ${JSON.stringify(prevista)}.`);
  }
  const variante = extras.variante_datos_coinciden_sin_critico;
  if (typeof variante !== 'boolean') {
    throw new Error(`extras.variante_datos_coinciden_sin_critico debe ser booleano y vale ${JSON.stringify(variante)}.`);
  }
  return {
    TIPIFICACION_AGENTE: prevista === null || prevista === undefined ? tipificacionEsperada : prevista,
    VARIANTE_IDENTIDAD: variante ? 'datos_coinciden_sin_critico' : 'ninguna',
  };
}

// Valores de los marcadores del prompt del generador, con los formatos de la
// tabla "Marcadores que llena W0" de prompts/generador_ce_v3.md. Entrada: la
// salida de completarEscenario (js/simulador.js, reglas-js), las hojas de
// referencia y el texto de la plantilla.
//   escenario  { conversation_id, calidad_esperada, tema_esperado, tipificacion_esperada,
//                errores_criticos_inyectados[], criterios_que_deben_fallar[], casos_dificiles[] }
//   extras     { fecha_hora_inicio, tipificacion_agente_prevista|null, variante_datos_coinciden_sin_critico }
//   cuenta     fila de la hoja cuentas
//   catalogo_temas, base_conocimiento, listas: filas de las hojas
//   config     claves ya resueltas (JS-1: listas como arreglo, booleanos true/false)
//   tipo_interaccion  "ce"
//   plantilla  texto completo de prompts/generador_ce_vN.md (el mismo que recibe
//              construirPeticionGenerador)
// Listas vacías -> "ninguno". Un dato obligatorio que falta -> error explícito
// (mejor detener W0 que mandar un prompt incompleto al modelo).
//
// Cómo se adapta a la versión (v1, v2 o v3): por los MARCADORES PRESENTES en el
// bloque ENTRADA de la plantilla. valoresGenerador lee ese bloque, encuentra los
// <<NOMBRE>> que contiene y calcula solo esos (13 en v1, 15 en v2, 17 en v3).
// Así no hay una tabla "versión -> marcadores" que mantener a mano: la plantilla
// pegada en n8n es la única fuente. Un marcador que JS no conoce detiene W0.
// Cada valor se calcula solo si su marcador está en la plantilla: v1 no exige
// los extras de v2 ni el artículo del tema de v3.
const CAMPOS_CUENTA_GENERADOR = ['cuenta_id', 'titular', 'razon_social', 'rfc', 'correo', 'telefono', 'giro', 'tamano'];
const TIPOS_LISTA_GENERADOR = ['frase_criterio', 'termino_prohibido', 'frase_negativa', 'vicio_lenguaje', 'palabra_altisonante'];
const CLAVES_CONFIG_GENERADOR = [
  'marca', 'chat_primera_respuesta_seg', 'chat_umbral_espera_seg', 'chat_retomar_espera_seg', 'chat_espera_maxima_seg',
  'chat_recordatorio_inactividad_seg', 'chat_cierre_inactividad_seg', 'seguimiento_plazo_max_horas_habiles',
  'apertura_mensajes_agente', 'apertura_privacidad_mensajes_agente', 'cierre_mensajes_agente', 'identidad_min_datos_correctos',
  'campana_vigente_activa', 'canales_oficiales_correos', 'canales_oficiales_telefonos', 'rfc_genericos_permitidos',
  'enmascarado_correo_visibles_inicio', 'enmascarado_telefono_visibles_final', 'enmascarado_rfc_visibles_final',
  // Desde generador_ce_v3 (30-oct-2026): umbrales que nombra la guía de fallas.
  'mayusculas_min_palabras_consecutivas', 'mayusculas_min_longitud_palabra', 'ortografia_umbral_graves',
  'ortografia_umbral_menores', 'signos_apertura_max_omisiones',
];
// Todos los marcadores que sabe llenar valoresGenerador (13 de v1 + 2 de v2 + 2 de v3).
const MARCADORES_GENERADOR = [
  'CONVERSATION_ID', 'CUENTA', 'FECHA_HORA_INICIO', 'TEMA_ESPERADO', 'TIPIFICACION_ESPERADA', 'CALIDAD_ESPERADA',
  'ERRORES_CRITICOS_INYECTADOS', 'CRITERIOS_QUE_DEBEN_FALLAR', 'CASOS_DIFICILES', 'CATALOGO_TEMAS', 'BASE_CONOCIMIENTO',
  'FRASES_REFERENCIA', 'PARAMETROS_CONFIG',
  'TIPIFICACION_AGENTE', 'VARIANTE_IDENTIDAD',
  'ARTICULO_DEL_TEMA', 'GUIA_FALLAS',
];
const CALIDADES_GENERADOR = ['buena', 'regular', 'mala'];

const textoObligatorio = (valor, nombre) => {
  if (valor === undefined || valor === null || String(valor).trim() === '') throw new Error(`Falta ${nombre} para el prompt del generador.`);
  return String(valor).trim();
};
// Arreglo (de completarEscenario) o texto "a|b" (celda de Sheets) -> "a, b" o "ninguno".
const listaOninguno = (valor) => {
  const l = leerListaConfig(valor);
  return l.length ? l.join(', ') : 'ninguno';
};
// Valor de config para el prompt: booleanos como si/no (como en Sheets) y listas con ", ".
const valorConfigTexto = (v) => (v === true ? 'si' : v === false ? 'no' : Array.isArray(v) ? (v.length ? v.join(', ') : 'ninguno') : String(v));

// Catálogo para el GENERADOR: necesita tipificaciones y campos obligatorios, a
// diferencia de formatearCatalogo() (evaluador), que solo muestra temas. Usa los
// mismos filtros (filtrarPorTipo + esActivo). campos_obligatorios se separan con
// ", " para no confundirse con el separador " | " de columnas.
function formatearCatalogoGenerador(catalogoTemas, tipoInteraccion) {
  const filas = filtrarPorTipo(catalogoTemas, tipoInteraccion).filter(esActivo);
  if (filas.length === 0) throw new Error(`No hay temas activos en catalogo_temas para tipo_interaccion ${tipoInteraccion}.`);
  return filas
    .map((f) => [f.tema, f.tipificacion_valida, f.requiere_escalamiento, leerListaConfig(f.campos_obligatorios).join(', ') || 'ninguno', f.id_articulo || '(sin artículo)'].join(' | '))
    .join('\n');
}

// Frases de referencia: una línea por clave_lista (orden de aparición), solo filas
// activas del tipo ∪ todos y de los tipos de lista del generador. Las expresiones
// regulares se marcan con "(regex)".
function formatearFrasesReferencia(listas, tipoInteraccion) {
  const porClave = new Map();
  for (const f of filtrarPorTipo(listas, tipoInteraccion)) {
    if (!esActivo(f) || !TIPOS_LISTA_GENERADOR.includes(f.tipo_lista)) continue;
    const valor = f.es_regex === 'si' || f.es_regex === true ? `${f.valor} (regex)` : String(f.valor);
    if (!porClave.has(f.clave_lista)) porClave.set(f.clave_lista, []);
    porClave.get(f.clave_lista).push(valor);
  }
  if (porClave.size === 0) throw new Error(`No hay frases activas en listas para tipo_interaccion ${tipoInteraccion}.`);
  return [...porClave].map(([clave, valores]) => `${clave}: ${valores.join(' | ')}`).join('\n');
}

// ARTICULO_DEL_TEMA (generador v3): el artículo de base_conocimiento que
// corresponde a la tipificación ESPERADA (no a la del agente: con
// critico.tipificacion_incorrecta la conversación sigue tratando la situación
// esperada). Une las dos hojas por id_articulo de catalogo_temas.
// sheets.md garantiza que tipificacion_valida es única dentro de tipo ∪ todos,
// así que la fila es una sola. Detiene W0 con un error explícito si:
//   - no hay exactamente 1 fila activa (tipo ∪ todos) con esa tipificación;
//   - el tema de esa fila no es temaEsperado;
//   - la fila no tiene id_articulo;
//   - no hay exactamente 1 artículo con ese id en base_conocimiento (tipo ∪ todos).
// No hay respaldo "(sin artículo)": sin artículo volvería la falla que v3 corrige.
function articuloDelTema(catalogoTemas, baseConocimiento, tipificacionEsperada, temaEsperado, tipoInteraccion) {
  const tipificacion = textoObligatorio(tipificacionEsperada, 'la tipificación esperada');
  const tema = textoObligatorio(temaEsperado, 'el tema esperado');
  const tipo = textoObligatorio(tipoInteraccion, 'tipo_interaccion');
  const filas = filtrarPorTipo(catalogoTemas, tipo)
    .filter(esActivo)
    .filter((f) => String(f.tipificacion_valida ?? '').trim() === tipificacion);
  if (filas.length !== 1) {
    throw new Error(
      `catalogo_temas debe tener exactamente 1 fila activa (${tipo} o todos) con tipificacion_valida "${tipificacion}" y tiene ${filas.length}: no se puede elegir el artículo del tema.`
    );
  }
  const fila = filas[0];
  if (String(fila.tema ?? '').trim() !== tema) {
    throw new Error(`La tipificación "${tipificacion}" pertenece al tema "${fila.tema}" en catalogo_temas, no a "${tema}" (tema esperado del escenario).`);
  }
  const id = String(fila.id_articulo ?? '').trim();
  if (id === '') throw new Error(`La fila de catalogo_temas de "${tipificacion}" no tiene id_articulo: no se puede elegir el artículo del tema.`);
  const articulos = filtrarPorTipo(baseConocimiento, tipo).filter((a) => String(a.id_articulo ?? '').trim() === id);
  if (articulos.length !== 1) {
    throw new Error(`base_conocimiento debe tener exactamente 1 artículo ${id} (${tipo} o todos) y tiene ${articulos.length}: no se puede armar el artículo del tema de "${tipificacion}".`);
  }
  return formatearArticulo(articulos[0]);
}

// GUIA_FALLAS (generador v3): de la guía completa que vive en la plantilla
// (bloque <!-- INICIO_GUIA_FALLAS --> ... <!-- FIN_GUIA_FALLAS -->, que NO se
// envía), copia solo las líneas de los criterios pedidos, en el orden pedido.
//   - Una línea de la guía tiene la forma "- seccion.subelemento: texto". Las
//     líneas que no empiezan con "- " son títulos y se ignoran; una que empieza
//     con "- " pero no tiene esa forma, o un criterio repetido, detiene W0.
//   - Sin criterios -> 'ninguno'.
//   - Un criterio pedido sin línea en la guía -> error (mejor detener W0 que
//     pedir una falla sin instrucciones).
// criterios: arreglo (de completarEscenario) o texto "a|b".
function guiaFallas(plantilla, criterios) {
  if (typeof plantilla !== 'string' || plantilla.trim() === '') throw new Error('Falta la plantilla del generador para leer la guía de fallas.');
  const bloque = extraerBloque(plantilla.replace(/\r\n/g, '\n'), 'GUIA_FALLAS');
  const lineas = new Map();
  for (const cruda of bloque.split('\n')) {
    const linea = cruda.trim();
    if (!linea.startsWith('- ')) continue;
    const m = linea.match(/^- ([a-z_]+\.[a-z_]+): \S/);
    if (!m) throw new Error(`La guía de fallas tiene una línea mal formada (se espera "- seccion.subelemento: ..."): "${linea.slice(0, 80)}".`);
    if (lineas.has(m[1])) throw new Error(`La guía de fallas tiene dos líneas para ${m[1]}.`);
    lineas.set(m[1], linea);
  }
  const pedidos = [...new Set(leerListaConfig(criterios))];
  if (pedidos.length === 0) return 'ninguno';
  const faltan = pedidos.filter((c) => !lineas.has(c));
  if (faltan.length) {
    throw new Error(`La guía de fallas de la plantilla no tiene línea para: ${faltan.join(', ')}. Agrega la línea en el bloque GUIA_FALLAS del prompt o quita el criterio del escenario.`);
  }
  return pedidos.map((c) => lineas.get(c)).join('\n');
}

// Marcadores <<NOMBRE>> del bloque ENTRADA de una plantilla, sin repetir, en orden de aparición.
function marcadoresDePlantilla(plantilla) {
  const { plantilla_entrada } = leerPlantilla(plantilla);
  return [...new Set((plantilla_entrada.match(/<<[A-Z_]+>>/g) || []).map((m) => m.slice(2, -2)))];
}

function valoresGenerador({ escenario, extras, cuenta, catalogo_temas, base_conocimiento, listas, config, tipo_interaccion, plantilla } = {}) {
  if (!escenario || typeof escenario !== 'object') throw new Error('Falta el escenario (completarEscenario).');
  if (!cuenta || typeof cuenta !== 'object') throw new Error('Falta la cuenta elegida.');
  if (!config || typeof config !== 'object') throw new Error('Falta config.');
  if (typeof plantilla !== 'string' || plantilla.trim() === '') {
    throw new Error('Falta la plantilla del generador (texto completo de prompts/generador_ce_vN.md): valoresGenerador la necesita para saber qué marcadores llenar.');
  }
  const tipo = textoObligatorio(tipo_interaccion, 'tipo_interaccion');
  const calidad = textoObligatorio(escenario.calidad_esperada, 'escenario.calidad_esperada');
  if (!CALIDADES_GENERADOR.includes(calidad)) throw new Error(`escenario.calidad_esperada debe ser buena, regular o mala (ya resuelta) y vale ${JSON.stringify(calidad)}.`);
  const tipificacionEsperada = textoObligatorio(escenario.tipificacion_esperada, 'escenario.tipificacion_esperada');

  const marcadores = marcadoresDePlantilla(plantilla);
  const desconocidos = marcadores.filter((m) => !MARCADORES_GENERADOR.includes(m));
  if (desconocidos.length) {
    throw new Error(`La plantilla del generador tiene marcadores que valoresGenerador no sabe llenar: ${desconocidos.map((m) => `<<${m}>>`).join(', ')}.`);
  }

  // Un cálculo por marcador; solo se ejecutan los de la plantilla.
  let extrasCalculados = null;
  const extrasV2 = () => (extrasCalculados = extrasCalculados || valoresExtrasGenerador(extras, tipificacionEsperada));
  const calculos = {
    CONVERSATION_ID: () => textoObligatorio(escenario.conversation_id, 'escenario.conversation_id'),
    CUENTA: () => CAMPOS_CUENTA_GENERADOR.map((c) => `${c}: ${textoObligatorio(cuenta[c], `cuenta.${c}`)}`).join('\n'),
    FECHA_HORA_INICIO: () => textoObligatorio(extras && extras.fecha_hora_inicio, 'extras.fecha_hora_inicio'),
    TEMA_ESPERADO: () => textoObligatorio(escenario.tema_esperado, 'escenario.tema_esperado'),
    TIPIFICACION_ESPERADA: () => tipificacionEsperada,
    CALIDAD_ESPERADA: () => calidad,
    ERRORES_CRITICOS_INYECTADOS: () => listaOninguno(escenario.errores_criticos_inyectados),
    CRITERIOS_QUE_DEBEN_FALLAR: () => listaOninguno(escenario.criterios_que_deben_fallar),
    CASOS_DIFICILES: () => listaOninguno(escenario.casos_dificiles),
    CATALOGO_TEMAS: () => formatearCatalogoGenerador(catalogo_temas, tipo),
    BASE_CONOCIMIENTO: () => formatearBaseConocimiento(base_conocimiento, tipo),
    FRASES_REFERENCIA: () => formatearFrasesReferencia(listas, tipo),
    PARAMETROS_CONFIG: () =>
      CLAVES_CONFIG_GENERADOR.map((c) => {
        if (config[c] === undefined || config[c] === null) throw new Error(`Falta config.${c} para el prompt del generador.`);
        return `${c}: ${valorConfigTexto(config[c])}`;
      }).join('\n'),
    TIPIFICACION_AGENTE: () => extrasV2().TIPIFICACION_AGENTE,
    VARIANTE_IDENTIDAD: () => extrasV2().VARIANTE_IDENTIDAD,
    ARTICULO_DEL_TEMA: () => articuloDelTema(catalogo_temas, base_conocimiento, tipificacionEsperada, escenario.tema_esperado, tipo),
    GUIA_FALLAS: () => guiaFallas(plantilla, escenario.criterios_que_deben_fallar),
  };
  return Object.fromEntries(marcadores.map((m) => [m, calculos[m]()]));
}

// Etiqueta corta de la API (minúsculas, dígitos y guion bajo). Cualquier otra
// cosa se reemplaza por "otro" para no copiar texto libre a Sheets o Telegram.
const etiquetaCorta = (x) => (typeof x === 'string' && /^[a-z0-9_]{1,40}$/.test(x) ? x : x === undefined || x === null ? null : 'otro');
const numeroONull = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);

// Lee la respuesta de la Messages API (cuerpo JSON con HTTP 200).
// Devuelve:
//   texto               texto del ÚNICO bloque type "text" ('' si no hay uno solo)
//   salida              JSON.parse(texto), o null si no parsea o no es objeto
//   completa            true solo si stop_reason = end_turn, hay un solo bloque
//                       de texto y el texto es un objeto JSON
//   motivo              null si completa; si no, una etiqueta fija:
//                         max_tokens           cortada por max_tokens
//                         refusal              el modelo se negó (ver categoria_rechazo)
//                         stop_reason_<x>      otro stop_reason inesperado
//                         sin_texto            ningún bloque type "text"
//                         varios_bloques_texto dos o más bloques "text" (no se concatenan)
//                         json_invalido        el texto no es un objeto JSON
//   stop_reason         etiqueta de la API
//   categoria_rechazo   stop_details.category si hubo refusal (etiqueta corta) o null
//   tokens_entrada      input_tokens + cache_creation_input_tokens + cache_read_input_tokens
//   tokens_salida       output_tokens (incluye razonamiento; es lo que se cobra)
//   tokens_razonamiento usage.output_tokens_details.thinking_tokens o null (informativo)
//   bloques_por_tipo    { thinking: 1, text: 1, ... } para diagnóstico
// tokens_* son null si la API no los mandó (W0 deja vacío el costo en ese caso).
// No valida el payload: eso lo hace validador_payload.js (reglas-js) con
// validarGeneracion(salida, ...), en el paso 4 de W0.
function leerRespuestaGenerador(respuestaApi) {
  const r = respuestaApi && typeof respuestaApi === 'object' ? respuestaApi : {};
  const bloques = Array.isArray(r.content) ? r.content : [];
  const bloques_por_tipo = {};
  for (const b of bloques) {
    const tipo = etiquetaCorta(b && b.type) || 'sin_tipo';
    bloques_por_tipo[tipo] = (bloques_por_tipo[tipo] || 0) + 1;
  }
  const textos = bloques.filter((b) => b && b.type === 'text');
  const texto = textos.length === 1 ? String(textos[0].text ?? '') : '';

  let salida = null;
  if (texto !== '') {
    try {
      const x = JSON.parse(texto);
      if (x && typeof x === 'object' && !Array.isArray(x)) salida = x;
    } catch (_) {
      salida = null;
    }
  }

  const stop_reason = etiquetaCorta(r.stop_reason);
  let motivo = null;
  if (stop_reason === 'max_tokens') motivo = 'max_tokens';
  else if (stop_reason === 'refusal') motivo = 'refusal';
  else if (stop_reason !== 'end_turn') motivo = `stop_reason_${stop_reason || 'ausente'}`;
  else if (textos.length === 0) motivo = 'sin_texto';
  else if (textos.length > 1) motivo = 'varios_bloques_texto';
  else if (salida === null) motivo = 'json_invalido';

  const u = r.usage && typeof r.usage === 'object' ? r.usage : {};
  const entrada = numeroONull(u.input_tokens);
  const tokens_entrada =
    entrada === null ? null : entrada + (numeroONull(u.cache_creation_input_tokens) || 0) + (numeroONull(u.cache_read_input_tokens) || 0);
  const detalles = u.output_tokens_details && typeof u.output_tokens_details === 'object' ? u.output_tokens_details : {};

  return {
    texto,
    salida,
    completa: motivo === null,
    motivo,
    stop_reason,
    categoria_rechazo: stop_reason === 'refusal' ? etiquetaCorta(r.stop_details && r.stop_details.category) : null,
    tokens_entrada,
    tokens_salida: numeroONull(u.output_tokens),
    tokens_razonamiento: numeroONull(detalles.thinking_tokens),
    bloques_por_tipo,
  };
}

// Prepara el siguiente intento tras accion = 'reintentar_validacion' de
// procesarRespuestaEvaluador (js/validador_llm.js): agrega el turno del modelo
// y los errores, y sube intentos_llm en 1. Devuelve solo los campos nuevos.
function prepararReintento(item) {
  if (!item || !item.peticion_openai) throw new Error('Falta item.peticion_openai.');
  if (!Number.isInteger(item.intentos_llm) || item.intentos_llm < 1) {
    throw new Error(`item.intentos_llm debe ser un entero >= 1 y vale ${JSON.stringify(item.intentos_llm)}.`);
  }
  if (typeof item.mensaje_reintento !== 'string' || item.mensaje_reintento === '') throw new Error('Falta item.mensaje_reintento.');
  return {
    peticion_openai: agregarReintento(item.peticion_openai, item.texto_respuesta_llm, item.mensaje_reintento),
    intentos_llm: item.intentos_llm + 1,
  };
}

// Prepara el reintento inmediato tras accion = 'reintentar_incompleta' de
// procesarRespuestaEvaluador: la MISMA petición, sin turnos nuevos (decisión del
// dueño, 24-oct-2026: el corte por commentary es intermitente). Sube
// intentos_llm (cuenta como llamada) e intentos_incompleta (contador propio,
// que no consume reintentos_validacion_llm). Devuelve solo los campos nuevos.
function prepararReintentoIncompleta(item) {
  if (!item || !item.peticion_openai) throw new Error('Falta item.peticion_openai.');
  if (!Number.isInteger(item.intentos_llm) || item.intentos_llm < 1) {
    throw new Error(`item.intentos_llm debe ser un entero >= 1 y vale ${JSON.stringify(item.intentos_llm)}.`);
  }
  const previas = item.intentos_incompleta === undefined || item.intentos_incompleta === null ? 0 : item.intentos_incompleta;
  if (!Number.isInteger(previas) || previas < 0) throw new Error(`item.intentos_incompleta debe ser un entero >= 0 y vale ${JSON.stringify(item.intentos_incompleta)}.`);
  return {
    peticion_openai: JSON.parse(JSON.stringify(item.peticion_openai)),
    intentos_llm: item.intentos_llm + 1,
    intentos_incompleta: previas + 1,
  };
}

const exportados = {
  extraerBloque,
  leerPlantilla,
  filtrarPorTipo,
  formatearCatalogo,
  formatearArticulo,
  formatearBaseConocimiento,
  formatearConversacion,
  llenarPlantillaEntrada,
  limpiarEsquema,
  leerListaConfig,
  leerEnteroPositivo,
  parametrosMuestreo,
  construirPeticion,
  agregarReintento,
  prepararReintento,
  prepararReintentoIncompleta,
  construirPeticionGenerador,
  valoresExtrasGenerador,
  formatearCatalogoGenerador,
  formatearFrasesReferencia,
  articuloDelTema,
  guiaFallas,
  marcadoresDePlantilla,
  MARCADORES_GENERADOR,
  CLAVES_CONFIG_GENERADOR,
  valoresGenerador,
  leerRespuestaGenerador,
};
if (typeof module !== 'undefined' && module.exports) module.exports = exportados;

// =============================================================================
// BLOQUE PARA EL NODO CODE DE n8n (JS-4)  —  modo "Run Once for Each Item"
// -----------------------------------------------------------------------------
// Cómo se pega:
//   1. Copia en el nodo Code TODO este archivo desde "'use strict';" hasta la
//      línea "const exportados = ..." (sin incluirla). n8n no puede hacer
//      require() de archivos locales, por eso se pegan las funciones.
//   2. Debajo, pega el bloque de abajo (sin los "// ").
//
// Cómo llega la plantilla del prompt:
//   - Un nodo Set llamado "Plantilla evaluador" con un campo de texto
//     plantilla_evaluador en modo FIJO (no expresión), donde se pega el archivo
//     completo prompts/evaluador_ce_v1.md. Los bloques que se envían no tienen
//     comillas invertidas ni "${", y los marcadores son <<...>> (no {{ }}), así
//     que n8n no los interpreta.
//   - Para pasar a v2: se pega evaluador_ce_v2.md y se cambia
//     config.version_prompt. Si no coinciden, leerPlantilla() detiene el nodo.
//
// Cómo llega el esquema: un nodo Set "Esquema LLM" con un campo JSON
// esquema_llm donde se pega contrato/llm_output.schema.json completo.
//
// La forma de "item" (extraccion, resultados_js, catalogo, config, payload) es
// la que entregan hoy JS-1, JS-2 y JS-3 de reglas-js. Los nombres de nodos y de
// campos nuevos (peticion_openai, texto_respuesta_llm, mensaje_reintento) son
// de ejemplo: no son campos del contrato y los fija workflows-n8n.
//
// const item = $input.item.json;                 // contexto de JS-1 a JS-3 (reglas-js)
// const cuerpo = construirPeticion(
//   {
//     plantilla: $('Plantilla evaluador').first().json.plantilla_evaluador,
//     esquema: $('Esquema LLM').first().json.esquema_llm,
//     mensajes: item.extraccion.mensajes_enmascarados,  // [{ n, emisor, timestamp, texto }] de JS-2
//     termina_por_inactividad: item.resultados_js.variables.termina_por_inactividad, // de JS-3
//     catalogo_temas: item.catalogo,                     // JS-1 ya lo filtró (tipo ∪ todos, activas)
//     base_conocimiento: $('Base de conocimiento').all().map((i) => i.json),
//     tipo_interaccion: item.payload.tipo_interaccion,
//     config: item.config,                               // JS-1: claves ya resueltas y convertidas
//   },
//   // Sin opciones: el esfuerzo de razonamiento (llm_esfuerzo_razonamiento),
//   // las claves a quitar del esquema (claves_esquema_excluidas_evaluador) y el
//   // tope max_output_tokens (max_tokens_evaluador, 8000) salen de config.
//   // Si falta max_tokens_evaluador en la hoja config, el nodo se detiene.
// );
// return { json: { ...item, peticion_openai: cuerpo, intentos_llm: 1 } };
//
// Reintento (nodo Code después de JS-5 cuando accion = reintentar_validacion):
// return { json: { ...$input.item.json, ...prepararReintento($input.item.json) } };
// Reintento inmediato (accion = reintentar_incompleta):
// return { json: { ...$input.item.json, ...prepararReintentoIncompleta($input.item.json) } };
// =============================================================================

// =============================================================================
// BLOQUE PARA LOS NODOS CODE DEL WORKFLOW 0 (Simulador) — generador
// -----------------------------------------------------------------------------
// Se pegan las funciones de este archivo (igual que arriba). La plantilla
// prompts/generador_ce_v3.md (la de config.version_prompt_generador) va en un nodo Set "Plantilla generador" (campo
// plantilla_generador, modo FIJO) y el esquema
// prompts/generador_payload_salida.schema.json en un nodo Set "Esquema
// generador" (campo JSON esquema_generador). Los nombres de nodos y de campos
// nuevos (peticion_claude, valores_generador, texto_generado, ...) son de
// ejemplo: no son campos del contrato y los fija workflows-n8n.
//
// Paso 3a, nodo Code "Construir petición generador", antes del HTTP Request.
// item trae { escenario, extras, cuenta } de completarEscenario (paso 2) y config.
// const item = $input.item.json;
// const valores = valoresGenerador({
//   escenario: item.escenario,
//   extras: item.extras,
//   cuenta: item.cuenta,
//   catalogo_temas: $('Leer hoja catalogo_temas').all().map((i) => i.json),
//   base_conocimiento: $('Leer hoja base_conocimiento').all().map((i) => i.json),
//   listas: $('Leer hoja listas').all().map((i) => i.json),
//   config: item.config,
//   tipo_interaccion: item.escenario.tipo_interaccion,
//   plantilla: $('Plantilla generador').first().json.plantilla_generador, // decide qué marcadores llenar (v1, v2 o v3)
// });
// const cuerpo = construirPeticionGenerador({
//   plantilla: $('Plantilla generador').first().json.plantilla_generador,
//   esquema: $('Esquema generador').first().json.esquema_generador,
//   valores,                          // los marcadores de la plantilla (17 en generador_ce_v3)
//   config: item.config,              // modelo_generador, version_prompt_generador, max_tokens_generador, esfuerzo_generador
// });
// // Encabezados del HTTP Request: x-api-key (credencial de n8n) y
// // anthropic-version = config.anthropic_version_api (no lo usa este código).
// return { json: { ...item, peticion_claude: cuerpo } };
//
// Paso 3b, nodo Code después del HTTP Request (respuesta HTTP 200 en $json):
// const lectura = leerRespuestaGenerador($input.item.json);
// // lectura.completa = false (max_tokens, refusal, json_invalido, ...) cuenta
// // como generación fallida: aplica config.reintentos_generacion.
// // lectura.tokens_entrada / tokens_salida van a escenarios.tokens_entrada /
// // tokens_salida y al cálculo de costo_generacion_usd (costo.js, reglas-js).
// // lectura.salida es lo que recibe validarGeneracion() de validador_payload.js.
// const previo = $('Construir petición generador').item.json;
// return { json: { ...previo, texto_generado: lectura.texto, salida_generador: lectura.salida, lectura_generador: lectura } };
// =============================================================================
