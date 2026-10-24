/**
 * Validación del payload (Workflow 1 Ingesta, paso 2, y Workflow 0 Simulador, paso 4).
 *
 * Qué valida:
 *  1. El esquema `contrato/payload.schema.json` (campos, tipos, formatos, enumeraciones,
 *     campos extra prohibidos). El esquema va copiado abajo (ESQUEMA_PAYLOAD) porque un
 *     nodo Code de n8n no puede leer archivos del repositorio; una prueba verifica que la
 *     copia sea idéntica al archivo del contrato.
 *  2. Las reglas que el esquema no puede expresar (descripción del propio esquema):
 *     - `n` consecutivos desde 1 y únicos;
 *     - timestamps que son fechas reales y no decrecen al ordenar por `n`;
 *     - `cuenta_id` existe en la hoja `cuentas`;
 *     - `estado_caso = sin_caso` si y solo si `numero_caso` es null (glosario, SUPUESTO).
 *  3. Si se pasa `config`: `canal` dentro de `canales_habilitados` y `tipo_interaccion`
 *     dentro de `tipos_interaccion_aceptados`.
 *
 * Los mensajes de error indican la ruta y la regla, nunca el texto de los mensajes, para
 * no copiar datos personales a `log_errores`.
 *
 * Además: `convertirSalidaGenerador` transforma la salida simplificada del generador del
 * simulador (donde `campos_capturados` llega como lista de {campo, estado}, porque la
 * salida estructurada no admite objetos con llaves libres) al payload del contrato.
 */

// Copia literal de contrato/payload.schema.json (la prueba js/tests verifica que no difiera).
const ESQUEMA_PAYLOAD = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://qa-cx-automation.example/contrato/payload.schema.json",
  "title": "Payload del webhook de Ingesta",
  "description": "Conversación de soporte por chat que recibe el Workflow 1 (Ingesta). Solo contiene datos observables de la conversación y del caso; nunca la verdad del escenario (calidad esperada, errores inyectados). El lote NO viaja en el cuerpo: llega como parámetro de consulta ?lote= (ver glosario.md). Reglas que este esquema no puede expresar y que valida JS en Ingesta: (1) los valores de n son consecutivos desde 1 y únicos; (2) los timestamps son fechas reales y no decrecen al ordenar por n; (3) cuenta_id existe en la hoja cuentas.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "conversation_id",
    "canal",
    "tipo_interaccion",
    "agente",
    "cuenta_id",
    "metadatos_caso",
    "mensajes"
  ],
  "properties": {
    "conversation_id": {
      "description": "Identificador único de la conversación. Nombre en inglés conservado del payload original (excepción registrada en glosario.md).",
      "type": "string",
      "pattern": "^CONV-[0-9]{4,}$"
    },
    "canal": {
      "description": "Canal de atención. Determina qué bloque de tiempos de config se aplica.",
      "type": "string",
      "enum": [
        "chat"
      ]
    },
    "tipo_interaccion": {
      "description": "Tipo de interacción: ce (Customer Experience) o sales (Sales). Valores en inglés a propósito (excepción registrada en glosario.md). Determina la rúbrica (config por tipo). En esta versión solo ce tiene rúbrica; sales es válido pero no se evalúa.",
      "type": "string",
      "enum": [
        "ce",
        "sales"
      ]
    },
    "agente": {
      "description": "Nombre del agente tal como se presenta al cliente.",
      "type": "string",
      "minLength": 1
    },
    "cuenta_id": {
      "description": "Cuenta del cliente en la hoja cuentas.",
      "type": "string",
      "pattern": "^CTA-[0-9]{3,}$"
    },
    "metadatos_caso": {
      "description": "Datos que el agente registró en el sistema de casos al atender la conversación.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "tipificacion_agente",
        "numero_caso",
        "estado_caso",
        "escalado",
        "campos_capturados"
      ],
      "properties": {
        "tipificacion_agente": {
          "description": "Tipificación elegida por el agente. Se compara contra catalogo_temas.tipificacion_valida (puede ser incorrecta a propósito).",
          "type": "string",
          "minLength": 1
        },
        "numero_caso": {
          "description": "Número de caso generado. null significa que el agente no generó caso (dispara critico.no_genera_caso). Debe ir presente aunque sea null.",
          "type": [
            "string",
            "null"
          ],
          "pattern": "^CASO-[0-9]{5}$"
        },
        "estado_caso": {
          "description": "Estado del caso al terminar la conversación. sin_caso si y solo si numero_caso es null.",
          "type": "string",
          "enum": [
            "abierto",
            "en_seguimiento",
            "cerrado",
            "sin_caso"
          ]
        },
        "escalado": {
          "description": "true si el agente escaló el caso.",
          "type": "boolean"
        },
        "campos_capturados": {
          "description": "Campos del caso capturados por el agente. Llave: nombre del campo según catalogo_temas.campos_obligatorios; valor: presente o ausente. Puede estar vacío.",
          "type": "object",
          "propertyNames": {
            "pattern": "^[a-z][a-z0-9_]*$"
          },
          "additionalProperties": {
            "type": "string",
            "enum": [
              "presente",
              "ausente"
            ]
          }
        }
      },
      "if": {
        "properties": {
          "numero_caso": {
            "type": "null"
          }
        },
        "required": [
          "numero_caso"
        ]
      },
      "then": {
        "properties": {
          "estado_caso": {
            "const": "sin_caso"
          }
        }
      },
      "else": {
        "properties": {
          "estado_caso": {
            "enum": [
              "abierto",
              "en_seguimiento",
              "cerrado"
            ]
          }
        }
      }
    },
    "mensajes": {
      "description": "Mensajes de la conversación en orden. Texto original, sin enmascarar.",
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "n",
          "emisor",
          "timestamp",
          "texto"
        ],
        "properties": {
          "n": {
            "description": "Número de mensaje, consecutivo desde 1.",
            "type": "integer",
            "minimum": 1
          },
          "emisor": {
            "description": "Quién envía el mensaje.",
            "type": "string",
            "enum": [
              "cliente",
              "agente"
            ]
          },
          "timestamp": {
            "description": "Hora local sin zona horaria, formato YYYY-MM-DDTHH:MM:SS. La zona está en config.zona_horaria.",
            "type": "string",
            "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$"
          },
          "texto": {
            "description": "Contenido del mensaje.",
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Validador mínimo de JSON Schema (solo las palabras clave que usan los esquemas del contrato)
// ---------------------------------------------------------------------------

function tipoDe(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  if (typeof valor === 'number') return Number.isInteger(valor) ? 'integer' : 'number';
  return typeof valor; // string, boolean, object
}

function cumpleTipo(valor, tipo) {
  const real = tipoDe(valor);
  if (tipo === 'number') return real === 'number' || real === 'integer';
  return real === tipo;
}

function resolverRef(ref, raiz) {
  if (!ref.startsWith('#/')) throw new Error(`referencia no soportada: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((nodo, parte) => nodo[parte], raiz);
}

/**
 * Valida `valor` contra `esquema`. Devuelve una lista de errores {ruta, mensaje}.
 * Soporta: $ref, type, enum, const, pattern, minLength, minimum, maximum, minItems,
 * required, properties, additionalProperties, propertyNames, items, allOf, if/then/else, not.
 */
function validarConEsquema(valor, esquema, raiz = esquema, ruta = '$') {
  const errores = [];
  if (esquema.$ref) errores.push(...validarConEsquema(valor, resolverRef(esquema.$ref, raiz), raiz, ruta));

  if (esquema.type !== undefined) {
    const tipos = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
    if (!tipos.some((t) => cumpleTipo(valor, t))) {
      errores.push({ ruta, mensaje: `tipo esperado ${tipos.join(' o ')}, llegó ${tipoDe(valor)}` });
      return errores; // sin el tipo correcto, el resto de reglas no tiene sentido
    }
  }
  if (esquema.enum && !esquema.enum.some((e) => e === valor)) errores.push({ ruta, mensaje: `valor fuera de los permitidos (${esquema.enum.join(', ')})` });
  if (Object.prototype.hasOwnProperty.call(esquema, 'const') && esquema.const !== valor) errores.push({ ruta, mensaje: `debe ser ${JSON.stringify(esquema.const)}` });

  if (typeof valor === 'string') {
    if (esquema.pattern && !new RegExp(esquema.pattern, 'u').test(valor)) errores.push({ ruta, mensaje: `no cumple el formato ${esquema.pattern}` });
    if (esquema.minLength !== undefined && [...valor].length < esquema.minLength) errores.push({ ruta, mensaje: `longitud mínima ${esquema.minLength}` });
  }
  if (typeof valor === 'number') {
    if (esquema.minimum !== undefined && valor < esquema.minimum) errores.push({ ruta, mensaje: `mínimo ${esquema.minimum}` });
    if (esquema.maximum !== undefined && valor > esquema.maximum) errores.push({ ruta, mensaje: `máximo ${esquema.maximum}` });
  }
  if (Array.isArray(valor)) {
    if (esquema.minItems !== undefined && valor.length < esquema.minItems) errores.push({ ruta, mensaje: `mínimo ${esquema.minItems} elementos` });
    if (esquema.items) valor.forEach((v, i) => errores.push(...validarConEsquema(v, esquema.items, raiz, `${ruta}[${i}]`)));
  }
  if (tipoDe(valor) === 'object') {
    for (const req of esquema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(valor, req)) errores.push({ ruta: `${ruta}.${req}`, mensaje: 'campo obligatorio ausente' });
    }
    const props = esquema.properties || {};
    for (const [k, v] of Object.entries(valor)) {
      if (esquema.propertyNames) {
        for (const e of validarConEsquema(k, esquema.propertyNames, raiz, `${ruta}.${k}`)) errores.push({ ruta: e.ruta, mensaje: `nombre de campo inválido: ${e.mensaje}` });
      }
      if (props[k]) errores.push(...validarConEsquema(v, props[k], raiz, `${ruta}.${k}`));
      else if (esquema.additionalProperties === false) errores.push({ ruta: `${ruta}.${k}`, mensaje: 'campo no permitido por el contrato' });
      else if (esquema.additionalProperties && typeof esquema.additionalProperties === 'object') errores.push(...validarConEsquema(v, esquema.additionalProperties, raiz, `${ruta}.${k}`));
    }
  }
  for (const sub of esquema.allOf || []) errores.push(...validarConEsquema(valor, sub, raiz, ruta));
  if (esquema.if) {
    const cumpleIf = validarConEsquema(valor, esquema.if, raiz, ruta).length === 0;
    if (cumpleIf && esquema.then) errores.push(...validarConEsquema(valor, esquema.then, raiz, ruta));
    if (!cumpleIf && esquema.else) errores.push(...validarConEsquema(valor, esquema.else, raiz, ruta));
  }
  if (esquema.not && validarConEsquema(valor, esquema.not, raiz, ruta).length === 0) errores.push({ ruta, mensaje: 'valor no permitido (not)' });
  return errores;
}

// ---------------------------------------------------------------------------
// Reglas que el esquema no expresa
// ---------------------------------------------------------------------------

/** ¿El texto YYYY-MM-DDTHH:MM:SS es una fecha y hora que existen en el calendario? */
function esFechaReal(timestamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(String(timestamp));
  if (!m) return false;
  const [, a, mes, d, h, mi, s] = m.map(Number);
  const f = new Date(Date.UTC(a, mes - 1, d, h, mi, s));
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d && f.getUTCHours() === h && f.getUTCMinutes() === mi && f.getUTCSeconds() === s;
}

function reglasAdicionales(payload, { cuentas, config }) {
  const errores = [];
  const mensajes = Array.isArray(payload.mensajes) ? payload.mensajes.filter((m) => m && Number.isInteger(m.n)) : [];

  // n consecutivos desde 1 y únicos.
  const ns = mensajes.map((m) => m.n).sort((a, b) => a - b);
  const consecutivos = ns.every((n, i) => n === i + 1);
  if (mensajes.length && !consecutivos) errores.push({ ruta: '$.mensajes', mensaje: 'los valores de n deben ser consecutivos desde 1 y sin repetir' });

  // Timestamps reales y que no decrecen al ordenar por n.
  const ordenados = [...mensajes].sort((a, b) => a.n - b.n);
  ordenados.forEach((m) => {
    if (typeof m.timestamp === 'string' && !esFechaReal(m.timestamp)) errores.push({ ruta: `$.mensajes[n=${m.n}].timestamp`, mensaje: 'no es una fecha y hora real' });
  });
  for (let i = 1; i < ordenados.length; i++) {
    const a = ordenados[i - 1].timestamp;
    const b = ordenados[i].timestamp;
    // El formato fijo permite comparar como texto: un texto mayor es una hora posterior.
    if (typeof a === 'string' && typeof b === 'string' && b < a) {
      errores.push({ ruta: `$.mensajes[n=${ordenados[i].n}].timestamp`, mensaje: `es anterior al timestamp del mensaje ${ordenados[i - 1].n}` });
    }
  }

  // cuenta_id existe en la hoja cuentas.
  if (cuentas) {
    const ids = cuentas.map((c) => (typeof c === 'string' ? c : c.cuenta_id));
    if (typeof payload.cuenta_id === 'string' && !ids.includes(payload.cuenta_id)) errores.push({ ruta: '$.cuenta_id', mensaje: 'no existe en la hoja cuentas' });
  }

  // sin_caso si y solo si numero_caso es null.
  const meta = payload.metadatos_caso;
  if (meta && typeof meta === 'object' && 'numero_caso' in meta && 'estado_caso' in meta) {
    if ((meta.numero_caso === null) !== (meta.estado_caso === 'sin_caso')) {
      errores.push({ ruta: '$.metadatos_caso.estado_caso', mensaje: 'estado_caso debe ser sin_caso si y solo si numero_caso es null' });
    }
  }

  // Valores aceptados según config.
  if (config) {
    if (Array.isArray(config.canales_habilitados) && typeof payload.canal === 'string' && !config.canales_habilitados.includes(payload.canal)) {
      errores.push({ ruta: '$.canal', mensaje: 'canal no habilitado en config.canales_habilitados' });
    }
    if (Array.isArray(config.tipos_interaccion_aceptados) && typeof payload.tipo_interaccion === 'string' && !config.tipos_interaccion_aceptados.includes(payload.tipo_interaccion)) {
      errores.push({ ruta: '$.tipo_interaccion', mensaje: 'tipo_interaccion no aceptado en config.tipos_interaccion_aceptados' });
    }
  }
  return errores;
}

/**
 * Valida un payload completo. `cuentas`: filas de la hoja `cuentas` (o lista de IDs).
 * `config`: objeto de configuración ya convertido (opcional).
 * Devuelve { valido, errores }.
 */
function validarPayload(payload, { cuentas = null, config = null } = {}) {
  if (tipoDe(payload) !== 'object') return { valido: false, errores: [{ ruta: '$', mensaje: 'el payload debe ser un objeto JSON' }] };
  const errores = [...validarConEsquema(payload, ESQUEMA_PAYLOAD), ...reglasAdicionales(payload, { cuentas, config })];
  return { valido: errores.length === 0, errores };
}

/**
 * Valida el parámetro de consulta `?lote=`. Si falta, usa `config.lote_por_defecto`.
 */
function validarLote(lote, config) {
  const valor = lote === undefined || lote === null || lote === '' ? config.lote_por_defecto : String(lote);
  const valido = /^(demo|calibracion_v[0-9]+)$/.test(valor);
  return { lote: valor, valido, errores: valido ? [] : [{ ruta: '?lote', mensaje: 'debe ser demo o calibracion_vN' }] };
}

/**
 * Convierte la salida simplificada del generador al payload del contrato.
 * - `metadatos_caso.campos_capturados`: lista [{campo, estado}] → objeto {campo: estado}.
 * - `fijos`: campos que decide el simulador en su paso 2 y no el modelo (por ejemplo
 *   conversation_id, cuenta_id, agente); si vienen, reemplazan lo que diga el modelo.
 * Devuelve { payload, errores }. Después se debe llamar a validarPayload.
 */
function convertirSalidaGenerador(salida, fijos = {}) {
  const errores = [];
  if (tipoDe(salida) !== 'object') return { payload: null, errores: [{ ruta: '$', mensaje: 'la salida del generador debe ser un objeto JSON' }] };
  const payload = JSON.parse(JSON.stringify(salida));
  Object.assign(payload, fijos);
  const meta = payload.metadatos_caso;
  if (meta && Array.isArray(meta.campos_capturados)) {
    const objeto = {};
    meta.campos_capturados.forEach((entrada, i) => {
      if (!entrada || typeof entrada.campo !== 'string' || typeof entrada.estado !== 'string') {
        errores.push({ ruta: `$.metadatos_caso.campos_capturados[${i}]`, mensaje: 'cada elemento debe tener campo y estado' });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(objeto, entrada.campo)) {
        errores.push({ ruta: `$.metadatos_caso.campos_capturados[${i}]`, mensaje: `campo repetido: ${entrada.campo}` });
        return;
      }
      objeto[entrada.campo] = entrada.estado;
    });
    meta.campos_capturados = objeto;
  }
  return { payload, errores };
}

/** Atajo para el Simulador (W0 paso 4): convierte y valida en un solo paso. */
function validarGeneracion(salida, { fijos = {}, cuentas = null, config = null } = {}) {
  const { payload, errores } = convertirSalidaGenerador(salida, fijos);
  if (!payload) return { valido: false, payload: null, errores };
  const validacion = validarPayload(payload, { cuentas, config });
  const todos = [...errores, ...validacion.errores];
  return { valido: todos.length === 0, payload, errores: todos };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ESQUEMA_PAYLOAD,
    validarConEsquema,
    esFechaReal,
    validarPayload,
    validarLote,
    convertirSalidaGenerador,
    validarGeneracion,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n
 * Pega TODO este archivo y, debajo, el bloque que corresponda sin comentar.
 *
 * --- W1 Ingesta, paso 2 (nodo Code "Validar payload", modo "Run Once for Each Item") ---
 * const cuentas = $('Leer cuentas').all().map((i) => i.json);
 * const config = $('Config cargada').first().json;     // objeto de cargarConfig (normalizacion.js)
 * const payload = $json.body;
 * const lote = validarLote($json.query && $json.query.lote, config);
 * const resultado = validarPayload(payload, { cuentas, config });
 * return { json: { payload, lote: lote.lote, valido: resultado.valido && lote.valido,
 *                  errores: [...resultado.errores, ...lote.errores] } };
 * // Un IF posterior manda los inválidos a log_errores (tipo_error = payload_invalido) y alerta.
 *
 * --- W0 Simulador, paso 4 (nodo Code "Validar generación", modo "Run Once for Each Item") ---
 * const salida = JSON.parse($json.texto_generado);     // respuesta del modelo generador
 * const r = validarGeneracion(salida, {
 *   fijos: { conversation_id: $json.conversation_id, cuenta_id: $json.cuenta_id },
 *   cuentas: $('Leer cuentas').all().map((i) => i.json),
 *   config: $('Config cargada').first().json,
 * });
 * return { json: { ...$json, payload: r.payload, valido: r.valido, errores: r.errores } };
 * // Si no es válido se reintenta config.reintentos_generacion veces; después, log_errores
 * // con tipo_error = generacion_invalida.
 * ------------------------------------------------------------------------- */
