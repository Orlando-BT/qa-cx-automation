/**
 * JS-1 Normalización (Workflow 2: Evaluación, paso 2).
 *
 * Qué hace:
 *  1. Carga la configuración de la hoja `config` para el `tipo_interaccion` de la
 *     conversación (el tipo concreto gana sobre `todos`) y convierte cada valor a su tipo.
 *  2. Filtra `listas` y `catalogo_temas` (filas del tipo ∪ `todos`, solo activas).
 *  3. Busca la cuenta del cliente en `cuentas` y carga y VALIDA la lista
 *     `numero_en_palabras` (palabra → cifra); si está mal armada, se detiene con error.
 *  4. Ordena los mensajes por `n`, convierte los timestamps a segundos, calcula el tiempo
 *     desde el mensaje anterior y separa mensajes del agente y del cliente.
 *  5. Calcula las ventanas de mensajes del agente que usan las reglas: primeros N
 *     (apertura), primeros N de privacidad y últimos N (cierre). N viene de `config`.
 *
 * Por qué existe: todas las reglas posteriores (JS-2 a JS-8) trabajan sobre la misma
 * conversación ya ordenada y medida. Si cada regla ordenara o midiera por su cuenta,
 * habría riesgo de que dos reglas vean la conversación distinta.
 *
 * Todo es JavaScript puro, sin dependencias. El archivo completo se puede pegar en un
 * nodo Code de n8n (ver bloque comentado al final).
 */

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/**
 * Marcadores especiales del glosario (sección 1). No se convierten a número: se dejan
 * como texto para que JS-8 y las alertas sepan que el valor real todavía no existe.
 */
const MARCADORES_ESPECIALES = ['por_verificar', 'pendiente_fase_1', 'sin_rubrica'];

/**
 * Convierte el texto de la celda `valor` según la columna `tipo`
 * (enumeración `tipo_dato_config`: entero, decimal, texto, booleano, lista).
 */
function convertirValorConfig(valor, tipo, clave) {
  const texto = valor === null || valor === undefined ? '' : String(valor).trim();
  if (MARCADORES_ESPECIALES.includes(texto)) return texto;
  switch (tipo) {
    case 'entero': {
      const numero = Number(texto);
      if (texto === '' || !Number.isInteger(numero)) {
        throw new Error(`config: la clave ${clave} debe ser entero y vale "${texto}"`);
      }
      return numero;
    }
    case 'decimal': {
      const numero = Number(texto);
      if (texto === '' || !Number.isFinite(numero)) {
        throw new Error(`config: la clave ${clave} debe ser decimal y vale "${texto}"`);
      }
      return numero;
    }
    case 'booleano':
      // En Sheets los booleanos se escriben si/no (glosario, sección 1).
      if (texto === 'si') return true;
      if (texto === 'no') return false;
      throw new Error(`config: la clave ${clave} debe ser si/no y vale "${texto}"`);
    case 'lista':
      // Listas en una celda: valores separados por | sin espacios.
      return texto === '' ? [] : texto.split('|').map((v) => v.trim());
    case 'texto':
      return texto;
    default:
      throw new Error(`config: tipo desconocido "${tipo}" en la clave ${clave}`);
  }
}

/**
 * Arma el objeto de configuración para un tipo de interacción.
 * Regla del contrato (config.md, sección 0): se leen las filas `todos` y las del tipo;
 * si una clave existe en ambas, gana la del tipo concreto.
 * Además valida que los pesos `peso_*` sumen 100 (config.md, sección 2).
 */
function cargarConfig(filasConfig, tipoInteraccion) {
  const config = {};
  const deTodos = filasConfig.filter((f) => f.tipo_interaccion === 'todos');
  const delTipo = filasConfig.filter((f) => f.tipo_interaccion === tipoInteraccion);
  // Primero `todos` y después el tipo: así el tipo sobrescribe.
  for (const fila of [...deTodos, ...delTipo]) {
    config[fila.clave] = convertirValorConfig(fila.valor, fila.tipo, fila.clave);
  }
  const pesos = Object.keys(config).filter((k) => k.startsWith('peso_'));
  if (pesos.length > 0) {
    const suma = pesos.reduce((acc, k) => acc + config[k], 0);
    // Se compara con tolerancia por los decimales de punto flotante.
    if (Math.abs(suma - 100) > 1e-9) {
      throw new Error(`config: los pesos de sección suman ${suma}, deben sumar 100`);
    }
  }
  return config;
}

/** Convierte si/no de Sheets a booleano (para columnas como `activo` o `es_regex`). */
function esSi(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim() === 'si';
}

/**
 * Filas de `listas` o `catalogo_temas` que aplican: las del tipo concreto UNIDAS a las
 * de `todos` (sin precedencia) y solo con `activo = si` (sheets.md).
 */
function filtrarPorTipoYActivas(filas, tipoInteraccion) {
  return filas.filter(
    (f) => (f.tipo_interaccion === tipoInteraccion || f.tipo_interaccion === 'todos') && esSi(f.activo)
  );
}

// ---------------------------------------------------------------------------
// Lista numero_en_palabras (palabra escrita -> cifra)
// ---------------------------------------------------------------------------

/** Texto comparable de una palabra: sin acentos, en minúsculas y con espacios simples. */
function normalizarPalabraNumero(texto) {
  return String(texto === undefined || texto === null ? '' : texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Carga la lista `numero_en_palabras` de `listas` y la convierte en un objeto
 * { "cuarenta y ocho": 48, "dos": 2, ... } que usa JS-3 para leer "dos dias habiles"
 * como "2 dias habiles" (glosario.md, "Convención de numero_en_palabras").
 *
 * Aquí la columna `notas` NO es un comentario: es la cifra. Por eso se valida al cargar,
 * y si algo está mal se lanza un error que dice qué fila falló. No se ignora la fila:
 * una cifra mal escrita haría que un plazo de "48 horas" se leyera como otro número y
 * la regla de seguimiento daría un resultado equivocado sin que nadie lo notara.
 *
 * Reglas (todas del contrato):
 *  - `notas` es un entero no vacío (solo dígitos).
 *  - No hay palabras repetidas (sin acentos ni mayúsculas).
 *  - No hay cifras repetidas: cada número tiene UNA sola palabra o frase. Por eso la
 *    lista trae "una" y no "uno" (ambas valdrían 1).
 * Además (convención del contrato: `valor` es texto, `es_regex = no`): el valor no puede
 * estar vacío ni ser una expresión regular.
 *
 * Recibe las filas ya filtradas (tipo ∪ todos y activas). Si no hay ninguna fila devuelve
 * un objeto vacío: la conversión simplemente no cambia nada.
 */
function cargarNumerosEnPalabras(filasListas) {
  const filas = filasListas.filter((f) => f.clave_lista === 'numero_en_palabras');
  const errores = [];
  const palabras = new Map(); // palabra normalizada -> cifra
  const cifras = new Map(); // cifra -> palabra con la que ya se usó
  for (const f of filas) {
    const palabra = normalizarPalabraNumero(f.valor);
    const notas = String(f.notas === undefined || f.notas === null ? '' : f.notas).trim();
    const etiqueta = `numero_en_palabras "${f.valor}"`;
    if (palabra === '') {
      errores.push('hay una fila con valor vacío');
      continue;
    }
    if (esSi(f.es_regex)) {
      errores.push(`${etiqueta}: es_regex debe ser no`);
      continue;
    }
    if (!/^[0-9]+$/.test(notas)) {
      errores.push(`${etiqueta}: notas debe ser un entero no vacío y vale "${notas}"`);
      continue;
    }
    const cifra = Number(notas);
    if (palabras.has(palabra)) {
      errores.push(`${etiqueta}: palabra duplicada`);
      continue;
    }
    if (cifras.has(cifra)) {
      errores.push(`${etiqueta}: la cifra ${cifra} ya tiene la palabra "${cifras.get(cifra)}"`);
      continue;
    }
    palabras.set(palabra, cifra);
    cifras.set(cifra, palabra);
  }
  if (errores.length > 0) {
    throw new Error(`listas: numero_en_palabras inválida, no se evalúa. ${errores.join('; ')}`);
  }
  return Object.fromEntries(palabras);
}

// ---------------------------------------------------------------------------
// Tiempos
// ---------------------------------------------------------------------------

/**
 * Convierte `YYYY-MM-DDTHH:MM:SS` (hora local sin zona) a segundos.
 * Se interpreta como si fuera UTC: solo nos importan las DIFERENCIAS entre mensajes de
 * la misma conversación, y todas están en la misma zona (`config.zona_horaria`).
 * Supuesto: no hay cambio de horario dentro de una conversación (México no tiene
 * horario de verano desde 2022).
 */
function timestampASegundos(timestamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(String(timestamp));
  if (!m) throw new Error(`timestamp con formato inválido: "${timestamp}"`);
  const [, a, mes, d, h, mi, s] = m.map(Number);
  return Date.UTC(a, mes - 1, d, h, mi, s) / 1000;
}

// ---------------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------------

/**
 * Normaliza la conversación del payload.
 * Devuelve los mensajes ordenados con `segundos` y `seg_desde_anterior`, y las listas de
 * números de mensaje que usan las reglas.
 */
function normalizarConversacion(payload, config) {
  const mensajes = [...payload.mensajes]
    .sort((a, b) => a.n - b.n)
    .map((m) => ({
      n: m.n,
      emisor: m.emisor,
      timestamp: m.timestamp,
      hora: String(m.timestamp).slice(11, 19), // HH:MM:SS, útil para evidencias
      segundos: timestampASegundos(m.timestamp),
      texto: m.texto,
    }));

  mensajes.forEach((m, i) => {
    m.seg_desde_anterior = i === 0 ? null : m.segundos - mensajes[i - 1].segundos;
  });

  const agente = mensajes.filter((m) => m.emisor === 'agente').map((m) => m.n);
  const cliente = mensajes.filter((m) => m.emisor === 'cliente').map((m) => m.n);

  // Las ventanas vienen de config para no fijar números en el código.
  const nApertura = config.apertura_mensajes_agente;
  const nPrivacidad = config.apertura_privacidad_mensajes_agente;
  const nCierre = config.cierre_mensajes_agente;

  return {
    mensajes,
    total_mensajes: mensajes.length,
    mensajes_agente: agente,
    mensajes_cliente: cliente,
    primeros_agente_apertura: agente.slice(0, nApertura),
    primeros_agente_privacidad: agente.slice(0, nPrivacidad),
    ultimos_agente_cierre: nCierre > 0 ? agente.slice(-nCierre) : [],
    primer_mensaje_es_agente: mensajes.length > 0 && mensajes[0].emisor === 'agente',
    // Caso 3.12 de la rúbrica: se evalúa solo con JS y no se llama al LLM.
    sin_mensajes_agente: agente.length === 0,
  };
}

/**
 * Punto de entrada de JS-1. Recibe el payload y las filas crudas de las hojas.
 * Devuelve el `contexto` que viaja por el resto del Workflow 2.
 */
function prepararContexto({ payload, lote, filasConfig, filasListas, filasCatalogo, filasCuentas }) {
  const tipo = payload.tipo_interaccion;
  const config = cargarConfig(filasConfig, tipo);
  const cuenta = filasCuentas.find((c) => c.cuenta_id === payload.cuenta_id);
  if (!cuenta) {
    // Ingesta ya valida que la cuenta exista; si llega aquí sin cuenta es un error de datos.
    throw new Error(`cuenta_id ${payload.cuenta_id} no existe en la hoja cuentas`);
  }
  const listas = filtrarPorTipoYActivas(filasListas, tipo);
  return {
    payload,
    lote: lote || config.lote_por_defecto,
    config,
    listas,
    // Se valida aquí, al cargar: si la lista está mal, el error sale antes de evaluar nada.
    numeros_en_palabras: cargarNumerosEnPalabras(listas),
    catalogo: filtrarPorTipoYActivas(filasCatalogo, tipo),
    cuenta,
    conversacion: normalizarConversacion(payload, config),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertirValorConfig,
    cargarConfig,
    filtrarPorTipoYActivas,
    cargarNumerosEnPalabras,
    timestampASegundos,
    normalizarConversacion,
    prepararContexto,
    esSi,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "JS-1 Normalización", modo "Run Once for All Items")
 * Cómo usarlo: pega TODO este archivo en el nodo y, debajo, este bloque sin comentar.
 * Los nombres de nodos entre $('...') son de ejemplo: ajústalos a los del workflow.
 *
 * const entrada = $('Conversación pendiente').first().json;   // fila de `conversaciones`
 * const payload = {
 *   conversation_id: entrada.conversation_id,
 *   canal: entrada.canal,
 *   tipo_interaccion: entrada.tipo_interaccion,
 *   agente: entrada.agente,
 *   cuenta_id: entrada.cuenta_id,
 *   metadatos_caso: {
 *     tipificacion_agente: entrada.tipificacion_agente,
 *     numero_caso: entrada.numero_caso || null,
 *     estado_caso: entrada.estado_caso,
 *     escalado: entrada.escalado === 'si',
 *     campos_capturados: JSON.parse(entrada.campos_capturados_json || '{}'),
 *   },
 *   mensajes: JSON.parse(entrada.mensajes_json),
 * };
 * const contexto = prepararContexto({
 *   payload,
 *   lote: entrada.lote,
 *   filasConfig: $('Leer config').all().map((i) => i.json),
 *   filasListas: $('Leer listas').all().map((i) => i.json),
 *   filasCatalogo: $('Leer catalogo_temas').all().map((i) => i.json),
 *   filasCuentas: $('Leer cuentas').all().map((i) => i.json),
 * });
 * // Versiones con las que se evalúa (vienen de la fila: pueden ser las del disparador manual).
 * contexto.versiones = { version_reglas: entrada.version_reglas, version_prompt: entrada.version_prompt };
 * // Formato del contrato: ISO 8601 sin milisegundos y con desfase (2026-10-21T10:05:01-06:00).
 * const iniciado = $now.setZone(contexto.config.zona_horaria).toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
 * contexto.marcas = { recibido_en: entrada.recibido_en, iniciado_en: iniciado };
 * return [{ json: contexto }];
 * ------------------------------------------------------------------------- */
