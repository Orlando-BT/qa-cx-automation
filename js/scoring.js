/**
 * JS-7 Scoring (Workflow 2: Evaluación, paso 9).
 *
 * Qué hace (decisiones del dueño registradas en contrato/rubrica.md, sección 2):
 *  - D1: agrega subelementos → sección (cumple, parcial, no_cumple, no_aplica) usando la
 *    clase de cada subelemento (clave, complementario, informativo) y el umbral de
 *    desempate `config.umbral_desempate_complementarios`.
 *  - D5: calcula `nota_base` solo con las secciones aplicables y la reescala a 100
 *    (renormalización). Ejemplo del contrato: 60.5 / 95 × 100 = 63.68.
 *  - D2: `nota_final` = 0 si hay al menos un error crítico detectado; si no, = nota_base.
 *  - `cumple_meta` compara nota_final con `config.meta_calidad` (≥ o > según
 *    `config.meta_comparacion_inclusiva`).
 *  - `calidad` (buena, regular, mala) con las bandas de rubrica.md 2.4.
 *
 * El LLM nunca calcula nada de esto: solo aporta juicios por criterio.
 *
 * La DEFINICIÓN de la rúbrica (secciones, subelementos, origen y clase) se guarda aquí
 * como datos, indexada por `version_reglas`. El motor es genérico: una rúbrica nueva
 * (por ejemplo Sales) se agrega como otra entrada de RUBRICAS sin cambiar las funciones.
 * Los pesos NO están aquí: se leen de config (`peso_<seccion>`).
 */

// [subelemento, origen, clase] en el orden de contrato/rubrica.md.
const RUBRICAS = {
  reglas_ce_v1: {
    secciones: [
      {
        id: 'apertura',
        subelementos: [
          ['saludo', 'JS', 'complementario'],
          ['bienvenida', 'JS', 'complementario'],
          ['marca', 'JS', 'complementario'],
          ['nombre_agente', 'JS', 'complementario'],
          ['ofrece_ayuda', 'JS', 'complementario'],
          ['aviso_privacidad', 'JS', 'clave'],
          ['nombre_cliente', 'JS', 'complementario'],
          ['toma_a_tiempo', 'JS', 'clave'],
        ],
      },
      {
        id: 'empatia',
        subelementos: [
          ['identifica_emocion', 'LLM', 'complementario'],
          ['muestra_empatia', 'LLM', 'clave'],
          ['cordialidad', 'LLM', 'clave'],
          ['lenguaje_acorde', 'LLM', 'complementario'],
          ['asertividad', 'LLM', 'complementario'],
          ['mayusculas_sostenidas', 'JS', 'complementario'],
        ],
      },
      {
        id: 'diagnostico',
        subelementos: [
          ['preguntas_necesarias', 'LLM', 'complementario'],
          ['solicitudes_detectadas', 'LLM', 'clave'],
          ['solicitudes_atendidas', 'LLM', 'clave'],
          ['numero_preguntas', 'JS', 'informativo'],
        ],
      },
      {
        id: 'solucion',
        subelementos: [
          ['informacion_correcta', 'LLM', 'clave'],
          ['informacion_completa', 'LLM', 'complementario'],
          ['apego_proceso', 'LLM', 'clave'],
          ['ofrece_alternativas', 'LLM', 'complementario'],
          ['escala_cuando_requiere', 'HIBRIDO', 'clave'],
          ['no_escala_innecesario', 'HIBRIDO', 'complementario'],
          ['campos_obligatorios', 'JS', 'complementario'],
          ['seguimiento_en_plazo', 'JS', 'complementario'],
        ],
      },
      {
        id: 'comunicacion',
        subelementos: [
          ['ortografia', 'HIBRIDO', 'clave'],
          ['signos_apertura', 'JS', 'complementario'],
          ['tecnicismos', 'JS', 'complementario'],
          ['frases_negativas', 'JS', 'complementario'],
          ['vicios_lenguaje', 'JS', 'complementario'],
          ['redaccion', 'LLM', 'complementario'],
          ['congruencia', 'LLM', 'complementario'],
          ['pide_espera', 'JS', 'complementario'],
          ['agradece_espera', 'JS', 'complementario'],
          ['retoma_a_tiempo', 'JS', 'complementario'],
          ['no_excede_espera', 'JS', 'clave'],
        ],
      },
      {
        id: 'recapitulacion',
        subelementos: [
          ['recapitula', 'LLM', 'clave'],
          ['uso_solucion_seguimiento', 'HIBRIDO', 'complementario'],
          ['informa_numero_caso', 'JS', 'clave'],
          ['numero_caso_coincide', 'JS', 'clave'],
          ['tipificacion', 'HIBRIDO', 'clave'],
          ['recordatorio_inactividad', 'JS', 'complementario'],
          ['cierre_inactividad', 'JS', 'complementario'],
        ],
      },
      {
        id: 'ayuda_adicional',
        subelementos: [
          ['ofrece_ayuda_adicional', 'JS', 'clave'],
          ['encuesta', 'JS', 'clave'],
          ['canales_horarios', 'JS', 'complementario'],
          ['campana_vigente', 'JS', 'complementario'],
          ['encuesta_caso_cerrado', 'JS', 'complementario'],
        ],
      },
      {
        id: 'cierre',
        subelementos: [
          ['agradece', 'JS', 'clave'],
          ['nombre_agente', 'JS', 'complementario'],
          ['marca', 'JS', 'complementario'],
          ['frase_cortesia', 'JS', 'complementario'],
          ['despedida', 'JS', 'clave'],
        ],
      },
    ],
    identidad: [
      ['pide_datos', 'JS'],
      ['datos_coinciden', 'JS'],
      ['orden_validacion', 'HIBRIDO'],
    ],
    criticos: [
      ['no_toma_a_tiempo', 'JS'],
      ['no_genera_caso', 'JS'],
      ['abandono', 'JS'],
      ['palabras_altisonantes', 'JS'],
      ['validacion_identidad', 'HIBRIDO'],
      ['confidencialidad', 'HIBRIDO'],
      ['tipificacion_incorrecta', 'HIBRIDO'],
      ['informacion_incorrecta', 'LLM'],
      ['promesa_no_autorizada', 'LLM'],
      ['negacion_servicio', 'LLM'],
      ['mala_actitud', 'LLM'],
      ['comentarios_negativos_marca', 'LLM'],
    ],
  },
};

function obtenerRubrica(versionReglas) {
  const rubrica = RUBRICAS[versionReglas];
  if (!rubrica) throw new Error(`JS-7: no hay definición de rúbrica para ${versionReglas}`);
  return rubrica;
}

/**
 * Lista plana de criterios esperados de la rúbrica, en el orden del contrato:
 * subelementos por sección, luego identidad y luego críticos.
 */
function criteriosEsperados(rubrica) {
  const esperados = [];
  for (const s of rubrica.secciones) {
    for (const [sub, origen, clase] of s.subelementos) {
      esperados.push({ id: `${s.id}.${sub}`, tipo_criterio: 'subelemento', seccion: s.id, origen, clasificacion: clase });
    }
  }
  for (const [sub, origen] of rubrica.identidad) esperados.push({ id: `identidad.${sub}`, tipo_criterio: 'identidad', seccion: 'identidad', origen, clasificacion: null });
  for (const [sub, origen] of rubrica.criticos) esperados.push({ id: `critico.${sub}`, tipo_criterio: 'critico', seccion: 'critico', origen, clasificacion: null });
  return esperados;
}

/**
 * Revisa que lleguen TODOS los criterios de la rúbrica, una sola vez y con el origen
 * correcto; completa `clasificacion` y los devuelve en el orden del contrato.
 * Si algo falta o sobra es un error del flujo: se detiene en lugar de calificar a medias.
 */
function completarCriterios(criterios, rubrica) {
  const porId = new Map();
  for (const c of criterios) {
    if (porId.has(c.id_criterio)) throw new Error(`JS-7: criterio duplicado ${c.id_criterio}`);
    porId.set(c.id_criterio, c);
  }
  const esperados = criteriosEsperados(rubrica);
  const ordenados = esperados.map((e) => {
    const c = porId.get(e.id);
    if (!c) throw new Error(`JS-7: falta el criterio ${e.id}`);
    if (c.origen !== e.origen) throw new Error(`JS-7: ${e.id} llegó con origen ${c.origen}, la rúbrica dice ${e.origen}`);
    porId.delete(e.id);
    return { ...c, tipo_criterio: e.tipo_criterio, seccion: e.seccion, clasificacion: e.clasificacion };
  });
  if (porId.size > 0) throw new Error(`JS-7: criterios que no están en la rúbrica: ${[...porId.keys()].join(', ')}`);
  return ordenados;
}

/**
 * D1: subelementos → sección. Solo cuentan `clave` y `complementario` que no sean
 * `no_aplica`; los `informativo` se ignoran siempre.
 */
function agregarSeccion(subelementos, umbralDesempate) {
  const aplicables = subelementos.filter((c) => c.clasificacion !== 'informativo' && c.resultado !== 'no_aplica');
  const clave = aplicables.filter((c) => c.clasificacion === 'clave');
  const complementarios = aplicables.filter((c) => c.clasificacion === 'complementario');
  const claveFallidos = clave.filter((c) => c.resultado === 'no_cumple').map((c) => c.id_criterio);
  const complementariosFallidos = complementarios.filter((c) => c.resultado === 'no_cumple').length;
  let resultado;
  if (aplicables.length === 0) resultado = 'no_aplica';
  else if (claveFallidos.length > 0) resultado = 'no_cumple';
  else if (complementariosFallidos === 0) resultado = 'cumple';
  // Desempate: proporción MAYOR que el umbral → no_cumple; menor o igual → parcial.
  else if (complementariosFallidos / complementarios.length > umbralDesempate) resultado = 'no_cumple';
  else resultado = 'parcial';
  return {
    resultado,
    clave_fallidos: claveFallidos,
    complementarios_aplicables: complementarios.length,
    complementarios_fallidos: complementariosFallidos,
  };
}

/** Factor de una sección: cumple = 1, parcial = config.factor_parcial, no_cumple = 0. */
function factorDe(resultado, config) {
  if (resultado === 'cumple') return 1;
  if (resultado === 'parcial') return config.factor_parcial;
  if (resultado === 'no_cumple') return 0;
  return null; // no_aplica: se excluye de la nota
}

function calcularSecciones(criterios, rubrica, config) {
  return rubrica.secciones.map((s) => {
    const peso = config[`peso_${s.id}`];
    if (typeof peso !== 'number') throw new Error(`JS-7: falta config.peso_${s.id}`);
    const agregado = agregarSeccion(criterios.filter((c) => c.tipo_criterio === 'subelemento' && c.seccion === s.id), config.umbral_desempate_complementarios);
    return {
      id_seccion: s.id,
      peso,
      resultado: agregado.resultado,
      factor: factorDe(agregado.resultado, config),
      clave_fallidos: agregado.clave_fallidos,
      complementarios_aplicables: agregado.complementarios_aplicables,
      complementarios_fallidos: agregado.complementarios_fallidos,
    };
  });
}

/** Redondeo aritmético (mitad hacia arriba) sin errores de punto flotante (1.005 → 1.01). */
function redondear(valor, decimales) {
  return Number(`${Math.round(Number(`${valor}e${decimales}`))}e-${decimales}`);
}

/**
 * D5: nota_base = suma(peso × factor) / suma(pesos aplicables) × 100.
 * Devuelve null si todas las secciones son no_aplica (no se genera evaluación).
 */
function calcularNotaBase(secciones, config) {
  const aplicables = secciones.filter((s) => s.resultado !== 'no_aplica');
  if (aplicables.length === 0) return null;
  const puntos = aplicables.reduce((acc, s) => acc + s.peso * s.factor, 0);
  const pesos = aplicables.reduce((acc, s) => acc + s.peso, 0);
  return redondear((puntos / pesos) * 100, config.decimales_nota);
}

/** Banda de calidad (rubrica.md 2.4). */
function calcularCalidad(notaFinal, tieneCritico, config) {
  if (tieneCritico) return 'mala';
  if (notaFinal >= config.calidad_buena_nota_min) return 'buena';
  if (notaFinal >= config.calidad_regular_nota_min) return 'regular';
  return 'mala';
}

/**
 * D2, meta y calidad a partir de secciones y criterios ya completos.
 */
function calcularResultado(secciones, criterios, config) {
  const notaBase = calcularNotaBase(secciones, config);
  if (notaBase === null) {
    const error = new Error('evaluacion_sin_secciones_aplicables: todas las secciones quedaron no_aplica');
    error.tipo_error = 'evaluacion_sin_secciones_aplicables';
    throw error;
  }
  const errores = criterios
    .filter((c) => c.tipo_criterio === 'critico' && c.resultado === 'detectado')
    .map((c) => ({ id_critico: c.id_criterio, origen: c.origen, evidencia: c.evidencia, justificacion: c.justificacion }));
  const tieneCritico = errores.length > 0;
  const notaFinal = tieneCritico ? 0 : notaBase;
  const cumpleMeta = config.meta_comparacion_inclusiva ? notaFinal >= config.meta_calidad : notaFinal > config.meta_calidad;
  return {
    nota_base: notaBase,
    nota_final: notaFinal,
    meta_calidad: config.meta_calidad,
    cumple_meta: cumpleMeta,
    calidad: calcularCalidad(notaFinal, tieneCritico, config),
    tiene_error_critico: tieneCritico,
    errores_criticos: errores,
  };
}

/**
 * Punto de entrada de JS-7. Arma la evaluación con la forma de evaluacion.schema.json,
 * excepto `consumo` y `marcas_tiempo.evaluado_en`, que completa JS-8 (costo.js).
 */
function construirEvaluacion(contexto) {
  const { config, payload, llm } = contexto;
  const versiones = contexto.versiones || { version_reglas: config.version_reglas, version_prompt: config.version_prompt };
  const rubrica = obtenerRubrica(versiones.version_reglas);
  const sinAgente = contexto.resultados_js.variables.sin_mensajes_agente;
  const criterios = completarCriterios([...contexto.resultados_js.criterios, ...contexto.resultados_hibridos.criterios], rubrica);
  const secciones = calcularSecciones(criterios, rubrica, config);
  const resultado = calcularResultado(secciones, criterios, config);
  const cid = payload.conversation_id;
  return {
    id_evaluacion: `EVAL-${cid}-${versiones.version_reglas}-${versiones.version_prompt}`,
    llave_dedup: `${cid}|${versiones.version_reglas}|${versiones.version_prompt}`,
    conversation_id: cid,
    lote: contexto.lote,
    canal: payload.canal,
    tipo_interaccion: payload.tipo_interaccion,
    agente: payload.agente,
    cuenta_id: payload.cuenta_id,
    version_reglas: versiones.version_reglas,
    version_prompt: versiones.version_prompt,
    // Sin mensajes del agente no se llamó al LLM: estos campos van en null (rubrica.md 3.12).
    modelo_evaluador: sinAgente ? null : config.modelo_evaluador,
    tema_detectado: sinAgente ? null : llm.tema.valor,
    emocion_cliente: sinAgente ? null : llm.emocion_cliente.emocion,
    nota_base: resultado.nota_base,
    nota_final: resultado.nota_final,
    meta_calidad: resultado.meta_calidad,
    cumple_meta: resultado.cumple_meta,
    calidad: resultado.calidad,
    tiene_error_critico: resultado.tiene_error_critico,
    sin_mensajes_agente: sinAgente,
    errores_criticos: resultado.errores_criticos,
    secciones,
    criterios,
    consumo: null, // lo completa JS-8
    marcas_tiempo: {
      recibido_en: contexto.marcas ? contexto.marcas.recibido_en : null,
      iniciado_en: contexto.marcas ? contexto.marcas.iniciado_en : null,
      evaluado_en: null, // lo completa JS-8
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RUBRICAS,
    obtenerRubrica,
    criteriosEsperados,
    completarCriterios,
    agregarSeccion,
    factorDe,
    calcularSecciones,
    redondear,
    calcularNotaBase,
    calcularCalidad,
    calcularResultado,
    construirEvaluacion,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "JS-7 Scoring", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 * Activa "On Error → Continue (using error output)": si todas las secciones quedan
 * no_aplica se lanza un error con tipo_error = evaluacion_sin_secciones_aplicables, que
 * el workflow registra en log_errores con alerta operativa (rubrica.md 2.2).
 *
 * const contexto = $json;
 * contexto.evaluacion = construirEvaluacion(contexto);
 * return { json: contexto };
 * ------------------------------------------------------------------------- */
