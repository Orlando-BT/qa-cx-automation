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

// Base de conocimiento completa (D3). Una celda vacía se muestra como
// "(sin información)" para que el modelo no confunda "no hay casos de
// escalamiento" con "no me dieron esa parte".
function formatearBaseConocimiento(baseConocimiento, tipoInteraccion) {
  const filas = filtrarPorTipo(baseConocimiento, tipoInteraccion)
    .slice()
    .sort((a, b) => String(a.id_articulo).localeCompare(String(b.id_articulo)));
  if (filas.length === 0) {
    throw new Error(`No hay artículos en base_conocimiento para tipo_interaccion ${tipoInteraccion}.`);
  }
  const celda = (v) => (v === undefined || v === null || String(v).trim() === '' ? '(sin información)' : String(v).trim());
  return filas
    .map((a) =>
      [
        `## ${a.id_articulo} | ${celda(a.titulo)}`,
        `Tema: ${celda(a.tema)}`,
        `Contenido: ${celda(a.contenido)}`,
        `Plazos: ${celda(a.plazos)}`,
        `Casos de escalamiento: ${celda(a.casos_escalamiento)}`,
        `Promociones autorizadas: ${celda(a.promociones_autorizadas)}`,
      ].join('\n')
    )
    .join('\n\n');
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
//   max_tokens_salida,           // opcional; si no se da, no se envía tope
// }
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
  if (opciones.max_tokens_salida) cuerpo.max_output_tokens = Number(opciones.max_tokens_salida);
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

const exportados = {
  extraerBloque,
  leerPlantilla,
  filtrarPorTipo,
  formatearCatalogo,
  formatearBaseConocimiento,
  formatearConversacion,
  llenarPlantillaEntrada,
  limpiarEsquema,
  leerListaConfig,
  parametrosMuestreo,
  construirPeticion,
  agregarReintento,
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
//   // Sin opciones: el esfuerzo de razonamiento (llm_esfuerzo_razonamiento)
//   // y las claves a quitar del esquema (claves_esquema_excluidas_evaluador)
//   // salen de config.
// );
// return { json: { ...item, peticion_openai: cuerpo, intentos_llm: 1 } };
//
// Reintento (nodo Code después de JS-5 cuando valido = false):
// const item = $input.item.json;
// const nueva = agregarReintento(item.peticion_openai, item.texto_respuesta_llm, item.mensaje_reintento);
// return { json: { ...item, peticion_openai: nueva, intentos_llm: item.intentos_llm + 1 } };
// =============================================================================
