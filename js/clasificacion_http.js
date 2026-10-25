/**
 * Clasificación de la respuesta HTTP de OpenAI (W2) y Claude (W0).
 *
 * Contexto: el nodo HTTP Request se configura con "respuesta completa" y "nunca fallar".
 * Así el workflow NO se detiene ante un 429 o un 500: el nodo entrega { statusCode,
 * headers, body } (o un error de red/timeout) y este código decide qué hacer:
 *
 *   - 'continuar'  → la API respondió bien (2xx); se sigue con el body.
 *   - 'reintentar' → falla pasajera (429, 5xx, red, timeout) y aún quedan reintentos;
 *                    se espera `espera_ms` y se vuelve a llamar.
 *   - 'falla_api'  → falla que no se arregla reintentando (otro 4xx: clave inválida,
 *                    petición mal formada, modelo inexistente...) o reintentos agotados.
 *                    Se registra en `log_errores` con tipo_error = fallo_api.
 *
 * Por qué así: un 429 o un 503 suelen resolverse solos en segundos, pero un 401 (clave
 * inválida) o un 400 (petición mal formada) fallarán igual las veces que se repita;
 * reintentarlos solo gastaría tiempo.
 *
 * Todo número sale de la configuración (reintentos_conexion_api,
 * espera_entre_reintentos_ms y espera_maxima_reintento_ms); nada fijo en el código. Función pura: no llama a la red
 * ni espera; solo decide. El nodo Wait del workflow hace la espera.
 */

/** Claves de config que esta función necesita. */
const CLAVES_REQUERIDAS = ['reintentos_conexion_api', 'espera_entre_reintentos_ms', 'espera_maxima_reintento_ms'];

/** Falla con mensaje claro si falta una clave de config o no es un entero >= 0. */
function validarConfig(config) {
  for (const clave of CLAVES_REQUERIDAS) {
    const valor = config ? config[clave] : undefined;
    if (!Number.isInteger(valor) || valor < 0) {
      throw new Error(`clasificacion_http: falta la clave de config ${clave} o no es un entero >= 0 (vale ${JSON.stringify(valor)})`);
    }
  }
  // La espera por defecto tampoco puede pasar del tope: sería una config incoherente.
  if (config.espera_entre_reintentos_ms > config.espera_maxima_reintento_ms) {
    throw new Error('clasificacion_http: espera_entre_reintentos_ms supera espera_maxima_reintento_ms en la config');
  }
}

/** Busca un encabezado sin importar mayúsculas (HTTP no distingue: Retry-After = retry-after). */
function leerEncabezado(headers, nombre) {
  if (!headers || typeof headers !== 'object') return undefined;
  const clave = Object.keys(headers).find((k) => k.toLowerCase() === nombre.toLowerCase());
  return clave === undefined ? undefined : headers[clave];
}

/**
 * Interpreta el encabezado Retry-After. Admite dos formatos del estándar HTTP:
 *   - segundos enteros: "7"
 *   - fecha HTTP: "Wed, 21 Oct 2026 07:28:00 GMT" (se resta la hora actual)
 * Devuelve milisegundos, o null si falta o no es válido (entonces se usa la espera de config).
 * `ahora` se recibe como parámetro para poder probarlo con una hora fija.
 */
function interpretarRetryAfter(valor, ahora) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  if (texto === '') return null;
  // Formato 1: solo dígitos = segundos.
  if (/^\d+$/.test(texto)) return Number(texto) * 1000;
  // Formato 2: fecha HTTP exacta ("Sat, 24 Oct 2026 12:00:09 GMT"). Se exige la forma completa
  // porque Date.parse de JavaScript es muy permisivo y aceptaría textos raros como fechas.
  if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(texto)) {
    const fecha = Date.parse(texto);
    if (Number.isNaN(fecha)) return null;
    // Si la fecha ya pasó, no hay que esperar más: 0.
    return Math.max(0, fecha - ahora.getTime());
  }
  return null;
}

/**
 * Decide qué hacer con la respuesta de la API.
 *
 * @param respuesta     { statusCode, headers, body } del nodo HTTP Request; o, ante error de
 *                      red/timeout, un objeto sin statusCode numérico (por ejemplo { error: {...} }).
 * @param intentoActual reintentos ya realizados (0 en la primera llamada).
 * @param config        objeto de configuración (JS-1).
 * @param ahora         opcional, solo para pruebas (Date).
 */
function clasificarRespuestaHttp(respuesta, intentoActual, config, ahora = new Date()) {
  validarConfig(config);
  const codigo = respuesta ? respuesta.statusCode : undefined;
  const hayCodigo = Number.isInteger(codigo);

  // 2xx: la API respondió bien.
  if (hayCodigo && codigo >= 200 && codigo < 300) return { accion: 'continuar' };

  // ¿Es una falla pasajera? 429 (límite de uso), 5xx (falla del proveedor) o sin código (red/timeout).
  const pasajera = !hayCodigo || codigo === 429 || (codigo >= 500 && codigo <= 599);

  if (!pasajera) {
    // Otro 4xx (o un código raro como 3xx): reintentar no ayuda.
    return { accion: 'falla_api', motivo: `La API respondió con código HTTP ${codigo}; no se reintenta`, codigo_http: codigo };
  }

  // Descripción corta SIN el contenido de la respuesta (podría traer datos o eco de la petición).
  const descripcion = hayCodigo ? `código HTTP ${codigo}` : 'error de red o tiempo de espera agotado';

  if (intentoActual < config.reintentos_conexion_api) {
    const retryAfter = hayCodigo ? interpretarRetryAfter(leerEncabezado(respuesta.headers, 'retry-after'), ahora) : null;
    // Si el proveedor pide esperar más que el tope, no vale la pena bloquear el workflow: falla.
    if (retryAfter !== null && retryAfter > config.espera_maxima_reintento_ms) {
      return {
        accion: 'falla_api',
        motivo: `La espera pedida por la API (${retryAfter} ms) supera el tope de ${config.espera_maxima_reintento_ms} ms; no se reintenta`,
        codigo_http: hayCodigo ? codigo : null,
      };
    }
    return { accion: 'reintentar', espera_ms: retryAfter !== null ? retryAfter : config.espera_entre_reintentos_ms, siguiente_intento: intentoActual + 1 };
  }

  return {
    accion: 'falla_api',
    motivo: `La API falló con ${descripcion} tras ${config.reintentos_conexion_api} reintentos`,
    codigo_http: hayCodigo ? codigo : null,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clasificarRespuestaHttp, interpretarRetryAfter };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "Clasificar respuesta HTTP", "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * // El nodo HTTP Request va con respuesta completa y "nunca fallar".
 * // `intento` lo lleva el workflow (0 en la primera llamada, +1 en cada reintento).
 * const respuesta = $json;
 * const resultado = clasificarRespuestaHttp(respuesta, $json.intento || 0, $('JS-1 Normalización').first().json.config);
 * return { json: { ...resultado } };
 * // Después, un nodo Switch por `accion`: continuar / reintentar (Wait espera_ms y vuelve
 * // al HTTP) / falla_api (log_errores con tipo_error = fallo_api y alerta operativa).
 * ------------------------------------------------------------------------- */
