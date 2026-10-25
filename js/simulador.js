/**
 * Workflow 0 (Simulador): completar el escenario (paso 2) y armar filas y envío (pasos 5 a 8).
 *
 * Qué hace este archivo, en palabras simples:
 *  1. Toma lo que el dueño escribió en el formulario (todo opcional) y lo valida.
 *  2. Completa lo que falta (calidad, tema, tipificación, cuenta, fallas y fecha de inicio) con un
 *     generador aleatorio CON SEMILLA: misma semilla + mismos datos = mismo escenario. La semilla se
 *     guarda en `escenarios.semilla_sorteo`.
 *  3. Genera conversation_id sin chocar con los existentes.
 *  4. Arma la fila de `escenarios` (la verdad oculta) y la de `revision_humana` (calificación a
 *     ciegas: sin verdad del escenario ni resultados).
 *  5. Arma el POST a Ingesta con SOLO el payload: la verdad del escenario nunca viaja con él.
 *
 * Regla del dueño: W0 rechaza el lote `calibracion_v1` (congelado: sus 24 conversaciones no se
 * regeneran ni se mezclan). Acepta `demo` y los demás lotes válidos del glosario.
 *
 * Decisiones de diseño (n8n no permite `require` entre nodos):
 *  - La lista de errores críticos de la rúbrica se DUPLICA aquí (CRITICOS_POR_VERSION); una prueba
 *    la compara con la de js/scoring.js para que no se desfasen.
 *  - `textoLegible` y `metadatosCasoLegible` (js/texto_legible.js) NO se copian: `filaRevisionHumana`
 *    las recibe como parámetro. En n8n basta pegar texto_legible.js junto a este archivo.
 *  - `marcaTiempoSistema` (js/costo.js) se duplica; una prueba verifica que es igual.
 */

// ---------------------------------------------------------------------------
// Valores del contrato (glosario)
// ---------------------------------------------------------------------------

const CALIDADES_SOLICITADAS = ['buena', 'regular', 'mala', 'aleatoria'];
const CALIDADES_ESPERADAS = ['buena', 'regular', 'mala'];
const CASOS_DIFICILES = ['amable_no_resuelve', 'resuelve_tono_seco', 'critico_escondido', 'tipificacion_incorrecta', 'validacion_fuera_de_orden'];
const PATRON_LOTE = /^(demo|calibracion_v[0-9]+)$/;
const PATRON_ID_CONVERSACION = /^CONV-([0-9]{4,})$/;

/**
 * Lotes congelados por regla del dueño: W0 no puede generar conversaciones en ellos.
 * Es una regla del dueño y no una clave de config.md; si en el futuro se congela otro lote se
 * agrega aquí (o se pasa en `lotesCongelados`).
 */
const LOTES_CONGELADOS = ['calibracion_v1'];

/**
 * Errores críticos de cada rúbrica (rubrica.md sección 5). Se necesita saber cuáles existen para
 * validar lo que el dueño pide inyectar. Copia de js/scoring.js (RUBRICAS), verificada por prueba.
 */
const CRITICOS_POR_VERSION = {
  reglas_ce_v1: [
    'critico.no_toma_a_tiempo',
    'critico.no_genera_caso',
    'critico.abandono',
    'critico.palabras_altisonantes',
    'critico.validacion_identidad',
    'critico.confidencialidad',
    'critico.tipificacion_incorrecta',
    'critico.informacion_incorrecta',
    'critico.promesa_no_autorizada',
    'critico.negacion_servicio',
    'critico.mala_actitud',
    'critico.comentarios_negativos_marca',
  ],
};

// Columnas de `escenarios` (20) y `revision_humana` (52), en el orden de sheets.md.
const COLUMNAS_ESCENARIOS = [
  'conversation_id',
  'lote',
  'tipo_interaccion',
  'generado_por',
  'calidad_solicitada',
  'calidad_esperada',
  'tema_esperado',
  'tipificacion_esperada',
  'errores_criticos_inyectados',
  'criterios_que_deben_fallar',
  'casos_dificiles',
  'descripcion_escenario',
  'cuenta_id',
  'modelo_generador',
  'version_prompt_generador',
  'tokens_entrada',
  'tokens_salida',
  'costo_generacion_usd',
  'generado_en',
  'semilla_sorteo',
];

const COLUMNAS_REVISION_HUMANA = [
  'conversation_id',
  'lote',
  'tipo_interaccion',
  'agente',
  'cuenta_id',
  'metadatos_caso_legible',
  'texto_legible',
  'estado_revision',
  'h_seccion__apertura',
  'h_seccion__empatia',
  'h_seccion__diagnostico',
  'h_seccion__solucion',
  'h_seccion__comunicacion',
  'h_seccion__recapitulacion',
  'h_seccion__ayuda_adicional',
  'h_seccion__cierre',
  'h_apertura__aviso_privacidad',
  'h_apertura__toma_a_tiempo',
  'h_empatia__muestra_empatia',
  'h_empatia__cordialidad',
  'h_diagnostico__solicitudes_detectadas',
  'h_diagnostico__solicitudes_atendidas',
  'h_solucion__informacion_correcta',
  'h_solucion__apego_proceso',
  'h_solucion__escala_cuando_requiere',
  'h_comunicacion__ortografia',
  'h_comunicacion__no_excede_espera',
  'h_recapitulacion__recapitula',
  'h_recapitulacion__informa_numero_caso',
  'h_recapitulacion__numero_caso_coincide',
  'h_recapitulacion__tipificacion',
  'h_ayuda_adicional__ofrece_ayuda_adicional',
  'h_ayuda_adicional__encuesta',
  'h_cierre__agradece',
  'h_cierre__despedida',
  'h_identidad__pide_datos',
  'h_identidad__datos_coinciden',
  'h_identidad__orden_validacion',
  'h_critico__no_toma_a_tiempo',
  'h_critico__no_genera_caso',
  'h_critico__abandono',
  'h_critico__palabras_altisonantes',
  'h_critico__validacion_identidad',
  'h_critico__confidencialidad',
  'h_critico__tipificacion_incorrecta',
  'h_critico__informacion_incorrecta',
  'h_critico__promesa_no_autorizada',
  'h_critico__negacion_servicio',
  'h_critico__mala_actitud',
  'h_critico__comentarios_negativos_marca',
  'comentarios_humano',
  'calificado_en',
];

function marcaTiempoSistema(fecha, zonaHoraria) {
  const partes = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(fecha)
    .forEach((p) => {
      partes[p.type] = p.value;
    });
  const local = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  const sinMs = Math.floor(fecha.getTime() / 1000) * 1000;
  const desfaseMin = Math.round((local - sinMs) / 60000);
  const signo = desfaseMin < 0 ? '-' : '+';
  const abs = Math.abs(desfaseMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${signo}${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function sinAcentos(texto) {
  return String(texto === undefined || texto === null ? '' : texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function vacio(valor) {
  return valor === undefined || valor === null || String(valor).trim() === '';
}

/**
 * Elige un elemento de la lista con el generador aleatorio recibido (`aleatorio()` devuelve un
 * número en [0, 1), como Math.random). En pruebas se pasa uno fijo para resultados repetibles.
 */
function elegirAleatorio(lista, aleatorio) {
  if (!Array.isArray(lista) || lista.length === 0) throw new Error('elegirAleatorio: la lista está vacía');
  if (typeof aleatorio !== 'function') throw new Error('elegirAleatorio: falta la función aleatoria');
  const r = aleatorio();
  if (typeof r !== 'number' || !(r >= 0 && r < 1)) throw new Error(`elegirAleatorio: el generador debe devolver un número en [0, 1) y devolvió ${r}`);
  return lista[Math.floor(r * lista.length)];
}

/** Filas activas del catálogo del tipo concreto unidas a las de `todos` (sheets.md). */
function catalogoDelTipo(catalogo, tipoInteraccion) {
  return catalogo.filter((f) => (f.tipo_interaccion === tipoInteraccion || f.tipo_interaccion === 'todos') && f.activo === 'si');
}

/** Lista separada por `|` o `,` (o arreglo) -> arreglo sin vacíos ni "ninguno". */
function separarLista(valor) {
  if (vacio(valor)) return [];
  const partes = Array.isArray(valor) ? valor : String(valor).split(/[|,]/);
  return partes.map((p) => String(p).trim()).filter((p) => p !== '' && sinAcentos(p) !== 'ninguno');
}

// ---------------------------------------------------------------------------
// Lote destino
// ---------------------------------------------------------------------------

/**
 * Valida el lote destino del formulario. Si viene vacío usa `config.lote_por_defecto`.
 * Devuelve { valido, lote, errores }.
 */
function validarLoteDestino(lote, config, lotesCongelados = LOTES_CONGELADOS) {
  const valor = vacio(lote) ? config.lote_por_defecto : String(lote).trim();
  if (!PATRON_LOTE.test(valor)) {
    return { valido: false, lote: valor, errores: [`lote "${valor}" no es válido: solo se acepta "demo" o "calibracion_vN" (por ejemplo calibracion_v2); escribe uno de esos o déjalo vacío para usar "${config.lote_por_defecto}"`] };
  }
  if (lotesCongelados.includes(valor)) {
    return {
      valido: false,
      lote: valor,
      errores: [`lote "${valor}" está congelado y no se regenera ni se mezcla con conversaciones nuevas; usa "demo" o un lote nuevo (calibracion_v2...)`],
    };
  }
  return { valido: true, lote: valor, errores: [] };
}

// ---------------------------------------------------------------------------
// Rúbrica para el sorteo de fallas (copias de datos, verificadas por prueba)
// ---------------------------------------------------------------------------

/**
 * Subelementos de cada rúbrica, para saber qué se puede pedir como falla.
 * Notación: `nombre*` = clave, `nombre~` = informativo, `nombre` = complementario.
 * Copia de js/scoring.js (RUBRICAS); una prueba comprueba que son iguales.
 * `identidad` no es sección ponderada: sus subelementos no tienen clase.
 */
const SUBELEMENTOS_POR_VERSION = {
  reglas_ce_v1: {
    secciones: {
      apertura: 'saludo bienvenida marca nombre_agente ofrece_ayuda aviso_privacidad* nombre_cliente toma_a_tiempo*',
      empatia: 'identifica_emocion muestra_empatia* cordialidad* lenguaje_acorde asertividad mayusculas_sostenidas',
      diagnostico: 'preguntas_necesarias solicitudes_detectadas* solicitudes_atendidas* numero_preguntas~',
      solucion: 'informacion_correcta* informacion_completa apego_proceso* ofrece_alternativas escala_cuando_requiere* no_escala_innecesario campos_obligatorios seguimiento_en_plazo',
      comunicacion: 'ortografia* signos_apertura tecnicismos frases_negativas vicios_lenguaje redaccion congruencia pide_espera agradece_espera retoma_a_tiempo no_excede_espera*',
      recapitulacion: 'recapitula* uso_solucion_seguimiento informa_numero_caso* numero_caso_coincide* tipificacion* recordatorio_inactividad cierre_inactividad',
      ayuda_adicional: 'ofrece_ayuda_adicional* encuesta* canales_horarios campana_vigente encuesta_caso_cerrado',
      cierre: 'agradece* nombre_agente marca frase_cortesia despedida*',
    },
    identidad: 'pide_datos datos_coinciden orden_validacion',
  },
};

/** Lista plana [{id, seccion, clase}] de los subelementos de una versión de reglas (clase null en identidad). */
function listarSubelementos(versionReglas) {
  const def = SUBELEMENTOS_POR_VERSION[versionReglas];
  if (!def) return null;
  const lista = [];
  for (const [seccion, texto] of Object.entries(def.secciones)) {
    for (const crudo of texto.split(' ')) {
      const clase = crudo.endsWith('*') ? 'clave' : crudo.endsWith('~') ? 'informativo' : 'complementario';
      lista.push({ id: `${seccion}.${crudo.replace(/[*~]$/, '')}`, seccion, clase });
    }
  }
  for (const nombre of def.identidad.split(' ')) lista.push({ id: `identidad.${nombre}`, seccion: 'identidad', clase: null });
  return lista;
}

/**
 * Combinaciones incompatibles: subelementos que NO se piden como falla junto con cada error crítico
 * (rubrica.md sección 8). Cada elemento es [subelemento, motivo]; motivo = implicado | inaplicable
 * | contradice. Una prueba compara esta tabla con la de rubrica.md.
 * SOLO la usa W0 (el sorteo del simulador); ningún archivo de evaluación la lee.
 */
const INCOMPATIBLES_CON_CRITICO = {
  'critico.no_toma_a_tiempo': [['apertura.toma_a_tiempo', 'implicado']],
  'critico.no_genera_caso': [
    ['recapitulacion.informa_numero_caso', 'inaplicable'],
    ['recapitulacion.numero_caso_coincide', 'inaplicable'],
    ['recapitulacion.uso_solucion_seguimiento', 'inaplicable'],
    ['solucion.seguimiento_en_plazo', 'inaplicable'],
    ['ayuda_adicional.encuesta', 'inaplicable'],
  ],
  'critico.abandono': [
    ['cierre.despedida', 'implicado'],
    ['recapitulacion.cierre_inactividad', 'contradice'],
  ],
  'critico.palabras_altisonantes': [],
  'critico.validacion_identidad': [
    ['identidad.pide_datos', 'implicado'],
    ['identidad.datos_coinciden', 'implicado'],
    ['identidad.orden_validacion', 'implicado'],
  ],
  'critico.confidencialidad': [],
  'critico.tipificacion_incorrecta': [['recapitulacion.tipificacion', 'implicado']],
  'critico.informacion_incorrecta': [['solucion.informacion_correcta', 'implicado']],
  'critico.promesa_no_autorizada': [],
  'critico.negacion_servicio': [
    ['diagnostico.solicitudes_atendidas', 'implicado'],
    ['diagnostico.solicitudes_detectadas', 'contradice'],
  ],
  'critico.mala_actitud': [['empatia.cordialidad', 'implicado']],
  'critico.comentarios_negativos_marca': [],
};

/**
 * Fallas "en sentido contrario": pedidas como falla activan por sí mismas un error crítico, así
 * que no se sortean (el escenario diría "sin crítico" y la conversación lo tendría).
 * `solucion.informacion_correcta` no está aquí: puede pedirse sin crítico si la información
 * incorrecta no tiene impacto (se anota en la descripción del escenario).
 */
const ACTIVA_CRITICO = {
  'apertura.toma_a_tiempo': 'critico.no_toma_a_tiempo',
  'recapitulacion.tipificacion': 'critico.tipificacion_incorrecta',
  'identidad.pide_datos': 'critico.validacion_identidad',
  'identidad.orden_validacion': 'critico.validacion_identidad',
  'identidad.datos_coinciden': 'critico.validacion_identidad',
};

/**
 * SUPUESTO del dueño (solo W0): `identidad.datos_coinciden` SÍ puede pedirse en calidad `regular`
 * en su variante SIN crítico: el cliente no alcanza el mínimo de datos acertados y el agente no
 * declina pero tampoco revela información de la cuenta. Solo se acepta si el dueño lo escribe en el
 * formulario; el sorteo automático no lo elige.
 */
const VARIANTE_SIN_CRITICO = 'identidad.datos_coinciden';

/** Pares que no pueden fallar juntos porque solo uno de los dos aplica (rubrica.md sección 8). */
const PARES_EXCLUYENTES = [
  ['solucion.escala_cuando_requiere', 'solucion.no_escala_innecesario'],
  ['ayuda_adicional.encuesta', 'ayuda_adicional.encuesta_caso_cerrado'],
];

/** Ids pedibles como falla (no informativos) de una sección. */
function validosDeSeccion(subelementos, seccion) {
  return subelementos.filter((s) => s.seccion === seccion && s.clase !== 'informativo').map((s) => s.id);
}

/** Texto de ayuda para un subelemento inexistente: los válidos de su sección o, si no se reconoce, las secciones. */
function sugerirSubelementos(id, subelementos) {
  const seccion = String(id).split('.')[0];
  const validos = validosDeSeccion(subelementos, seccion);
  if (validos.length) return `los válidos de ${seccion} son: ${validos.join(', ')}`;
  const secciones = [...new Set(subelementos.map((s) => s.seccion))];
  return `usa el formato seccion.subelemento con una sección de: ${secciones.join(', ')}`;
}

/**
 * Si `id` no puede pedirse como falla en este escenario devuelve el motivo (texto claro que
 * nombra el valor); si puede, null. Lo usan la validación del formulario Y el sorteo, para que
 * ambos apliquen exactamente las mismas reglas.
 * contexto: { version_reglas, criticos[], calidad, otros[] (otras fallas ya elegidas) }
 */
function motivoRechazoCriterio(id, contexto) {
  const subelementos = listarSubelementos(contexto.version_reglas);
  if (!subelementos) return `no hay rúbrica para ${contexto.version_reglas}; deja criterios_que_deben_fallar vacío para sorteo automático`;
  const sub = subelementos.find((s) => s.id === id);
  if (!sub) return `"${id}" no es un subelemento de ${contexto.version_reglas}; ${sugerirSubelementos(id, subelementos)}`;
  if (sub.clase === 'informativo') return `"${id}" es informativo y no puede pedirse como falla; quítalo o elige otro subelemento de ${sub.seccion} (${validosDeSeccion(subelementos, sub.seccion).join(", ")})`;
  for (const critico of contexto.criticos) {
    const fila = (INCOMPATIBLES_CON_CRITICO[critico] || []).find(([s]) => s === id);
    if (fila) return `"${id}" no puede pedirse como falla junto con ${critico} (${fila[1]}); quita "${id}" de criterios_que_deben_fallar o quita ${critico} de error_critico`;
  }
  const activado = ACTIVA_CRITICO[id];
  if (activado && !contexto.criticos.includes(activado)) {
    if (id === VARIANTE_SIN_CRITICO) {
      if (contexto.calidad !== 'regular' && contexto.calidad !== 'aleatoria') {
        return `"${id}" sin error crítico solo se acepta en calidad regular y llegó calidad ${contexto.calidad}; cambia calidad_solicitada a regular, o a mala con ${activado} en error_critico, o quita "${id}"`;
      }
    } else {
      return `"${id}" activaría ${activado}, que no se pidió; agrega ${activado} en error_critico (con calidad mala) o quita "${id}" de criterios_que_deben_fallar`;
    }
  }
  for (const par of PARES_EXCLUYENTES) {
    if (par.includes(id)) {
      const otro = par.find((p) => p !== id);
      if ((contexto.otros || []).includes(otro)) return `"${id}" y "${otro}" no pueden fallar juntos: solo uno de los dos aplica; quita uno de los dos de criterios_que_deben_fallar`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generador aleatorio con semilla
// ---------------------------------------------------------------------------

/**
 * Generador aleatorio con semilla (mulberry32): misma semilla, misma secuencia de números en
 * [0, 1). Es lo que permite reproducir un escenario a partir de `escenarios.semilla_sorteo`.
 */
function crearAleatorio(semilla) {
  if (!Number.isInteger(semilla) || semilla < 0 || semilla > 4294967295) {
    throw new Error(`La semilla debe ser un entero entre 0 y 4294967295 y llegó ${JSON.stringify(semilla)}`);
  }
  let estado = semilla >>> 0;
  return function aleatorio() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla nueva para el pegamento: entero entre 0 y 4294967295 a partir de un número en [0, 1). */
function semillaDesdeAleatorio(r) {
  return Math.floor(r * 4294967296) >>> 0;
}

// ---------------------------------------------------------------------------
// Horario de atención y fecha de inicio
// ---------------------------------------------------------------------------

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']; // posición = getUTCDay()

/**
 * Interpreta `config.horario_atencion_chat` (lista de elementos `<dias> HH:MM-HH:MM`, por ejemplo
 * `lun-vie 08:00-20:00` y `sab 09:00-14:00`). Devuelve [{dias:[1..5], inicio_min, fin_min}].
 * Un día que no aparece está cerrado. Formato inválido: error que nombra el elemento.
 */
function parsearHorario(elementos) {
  const lista = Array.isArray(elementos) ? elementos : String(elementos || '').split('|');
  if (lista.length === 0 || (lista.length === 1 && lista[0] === '')) throw new Error('horario_atencion_chat está vacío');
  return lista.map((elemento) => {
    const m = /^([a-z]{3})(?:-([a-z]{3}))? ([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/.exec(String(elemento).trim());
    if (!m) throw new Error(`horario_atencion_chat: elemento inválido "${elemento}" (formato "<dias> HH:MM-HH:MM")`);
    const desde = DIAS_SEMANA.indexOf(m[1]);
    const hasta = m[2] ? DIAS_SEMANA.indexOf(m[2]) : desde;
    if (desde < 0 || hasta < 0) throw new Error(`horario_atencion_chat: día desconocido en "${elemento}"`);
    const dias = [];
    for (let d = desde; ; d = (d + 1) % 7) {
      dias.push(d);
      if (d === hasta) break;
    }
    const inicio = Number(m[3]) * 60 + Number(m[4]);
    const fin = Number(m[5]) * 60 + Number(m[6]);
    if (fin <= inicio || inicio < 0 || fin > 24 * 60) throw new Error(`horario_atencion_chat: horas inválidas en "${elemento}"`);
    return { dias, inicio_min: inicio, fin_min: fin };
  });
}

/** Desfase en minutos de la zona en ese instante (a partir de la marca del sistema). */
function desfaseMinutos(fecha, zona) {
  const marca = marcaTiempoSistema(fecha, zona);
  const m = /([+-])([0-9]{2}):([0-9]{2})$/.exec(marca);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Instante (ms UTC) de una hora local (año, mes 1-12, día, minuto del día) en la zona. */
function instanteLocal(anio, mes, dia, minutoDelDia, zona) {
  const ingenuo = Date.UTC(anio, mes - 1, dia, 0, minutoDelDia);
  let desfase = desfaseMinutos(new Date(ingenuo), zona);
  let instante = ingenuo - desfase * 60000;
  const desfase2 = desfaseMinutos(new Date(instante), zona); // por si cruza un cambio de horario
  if (desfase2 !== desfase) {
    desfase = desfase2;
    instante = ingenuo - desfase * 60000;
  }
  return instante;
}

/**
 * Sortea la hora del primer mensaje (`<<FECHA_HORA_INICIO>>`, formato YYYY-MM-DDTHH:MM:SS, hora
 * local de `config.zona_horaria`) con UN solo número de `aleatorio`.
 * Cae dentro de `config.horario_atencion_chat`, entre `ahora - simulador_dias_atras` y `ahora`;
 * nunca en el futuro: si ahora está fuera de horario, el último instante válido es el cierre
 * anterior (los intervalos futuros se recortan a `ahora`).
 */
function sortearFechaInicio(config, ahora, aleatorio) {
  const zona = config.zona_horaria;
  const horario = parsearHorario(config.horario_atencion_chat);
  const dias = config.simulador_dias_atras;
  if (!Number.isInteger(dias) || dias < 0) throw new Error(`simulador_dias_atras debe ser un entero >= 0 y vale ${JSON.stringify(dias)}`);
  const limiteSup = Math.floor(ahora.getTime() / 1000) * 1000;
  const limiteInf = limiteSup - dias * 86400000;
  const hoy = marcaTiempoSistema(ahora, zona); // fecha local de hoy
  const [anio, mes, dia] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), Number(hoy.slice(8, 10))];
  const intervalos = [];
  for (let k = -dias - 1; k <= 0; k++) {
    const d = new Date(Date.UTC(anio, mes - 1, dia + k)); // día calendario local
    for (const h of horario) {
      if (!h.dias.includes(d.getUTCDay())) continue;
      const ini = Math.max(instanteLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h.inicio_min, zona), limiteInf);
      const fin = Math.min(instanteLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h.fin_min, zona), limiteSup);
      if (fin > ini) intervalos.push([ini, fin]);
    }
  }
  const total = intervalos.reduce((a, [i, f]) => a + (f - i) / 1000, 0);
  if (total <= 0) throw new Error('No hay ningún instante dentro del horario de atención en el rango pedido');
  let resto = Math.floor(aleatorio() * total);
  for (const [ini, fin] of intervalos) {
    const segundos = (fin - ini) / 1000;
    if (resto < segundos) return marcaTiempoSistema(new Date(ini + resto * 1000), zona).slice(0, 19);
    resto -= segundos;
  }
  throw new Error('sortearFechaInicio: no se pudo ubicar el instante sorteado');
}

// ---------------------------------------------------------------------------
// Sorteo de fallas
// ---------------------------------------------------------------------------

function enteroNoNegativo(valor, clave) {
  if (!Number.isInteger(valor) || valor < 0) throw new Error(`config.${clave} debe ser un entero >= 0 y vale ${JSON.stringify(valor)}`);
  return valor;
}

/**
 * Sortea las fallas cuando el formulario no las trae.
 *  - buena: ninguna.
 *  - regular: `generador_fallas_regular` subelementos COMPLEMENTARIOS de secciones distintas.
 *  - mala: `generador_fallas_mala` subelementos CLAVE (además del crítico, si hay).
 * Nunca informativos. Se descarta todo lo que `motivoRechazoCriterio` rechaza (combinaciones
 * incompatibles con los críticos, fallas que activarían un crítico no pedido y pares excluyentes).
 * Orden de los sorteos (para que la semilla reproduzca el resultado): regular, por cada falla se
 * sortea la sección y luego el subelemento; mala, por cada falla el subelemento.
 */
function sortearFallas({ calidad, criticos, versionReglas, config, aleatorio }) {
  const advertencias = [];
  if (calidad === 'buena') return { criterios: [], advertencias };
  const regular = calidad === 'regular';
  const n = enteroNoNegativo(regular ? config.generador_fallas_regular : config.generador_fallas_mala, regular ? 'generador_fallas_regular' : 'generador_fallas_mala');
  const clase = regular ? 'complementario' : 'clave';
  // Excepción del dueño (rubrica.md §8): en regular, identidad.datos_coinciden (variante sin crítico) también se puede sortear.
  const esCandidato = (s) => s.clase === clase || (regular && s.id === VARIANTE_SIN_CRITICO);
  const elegidos = [];
  const candidatosDe = () =>
    listarSubelementos(versionReglas).filter(
      (s) => esCandidato(s) && !elegidos.includes(s.id) && motivoRechazoCriterio(s.id, { version_reglas: versionReglas, criticos, calidad, otros: elegidos }) === null
    );
  for (let i = 0; i < n; i++) {
    let candidatos = candidatosDe();
    if (regular) {
      // Secciones distintas: se descartan las secciones que ya tienen una falla.
      const usadas = new Set(elegidos.map((id) => id.split('.')[0]));
      candidatos = candidatos.filter((s) => !usadas.has(s.seccion));
    }
    if (candidatos.length === 0) {
      advertencias.push(`Solo se pudieron sortear ${elegidos.length} de ${n} fallas (no quedan candidatos compatibles)`);
      break;
    }
    if (regular) {
      const secciones = [...new Set(candidatos.map((s) => s.seccion))];
      const seccion = elegirAleatorio(secciones, aleatorio);
      elegidos.push(elegirAleatorio(candidatos.filter((s) => s.seccion === seccion), aleatorio).id);
    } else {
      elegidos.push(elegirAleatorio(candidatos, aleatorio).id);
    }
  }
  return { criterios: elegidos, advertencias };
}

/** Valida una lista de fallas pedidas: cada una por separado y las combinaciones entre ellas. */
function validarCriteriosPedidos(criterios, { versionReglas, criticos, calidad }) {
  const errores = [];
  const repetidos = criterios.filter((c, i) => criterios.indexOf(c) !== i);
  if (repetidos.length) errores.push(`criterios_que_deben_fallar repetido: ${[...new Set(repetidos)].join(', ')}; escribe cada subelemento una sola vez`);
  for (const id of criterios) {
    const motivo = motivoRechazoCriterio(id, { version_reglas: versionReglas, criticos, calidad, otros: criterios.filter((c) => c !== id) });
    if (motivo) errores.push(`criterios_que_deben_fallar: ${motivo}`);
  }
  return errores;
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

/** Texto de ayuda para un tema inexistente: lista los temas activos (hasta 15) o dice dónde verlos. */
function sugerirTemas(filas) {
  const temas = [...new Set(filas.map((fila) => fila.tema))];
  if (temas.length === 0) return 'no hay temas activos para ese tipo; revisa la hoja catalogo_temas o déjalo vacío para sorteo';
  if (temas.length > 15) return 'consulta los temas activos en la hoja catalogo_temas (o déjalo vacío para sorteo)';
  return `escribe uno de: ${temas.join(', ')} (o déjalo vacío para sorteo)`;
}

/**
 * Valida y normaliza el formulario del simulador. Todos los campos son opcionales.
 *
 * formulario: { tema, calidad_solicitada, error_critico, criterios_que_deben_fallar, casos_dificiles,
 *               cantidad, lote, tipo_interaccion, semilla_sorteo }
 *   (SUPUESTO sobre los nombres: el contrato fija `calidad_solicitada`, `criterios_que_deben_fallar`,
 *   `casos_dificiles`, `semilla_sorteo`, `lote` y `tipo_interaccion`; `tema`, `error_critico` y
 *   `cantidad` son los de CLAUDE.md. `workflows-n8n` debe usar estos nombres en el Form Trigger.)
 * contexto: { config (con tipos_interaccion_aceptados, lote_por_defecto, simulador_max_conversaciones
 *             y, del tipo, version_reglas), catalogo (filas de la hoja) }
 *
 * `error_critico`, `criterios_que_deben_fallar` y `casos_dificiles` aceptan uno o varios valores
 * separados por `|` o `,`. Si el dueño escribe un subelemento que no existe, un caso difícil fuera
 * del glosario, un crítico que no es de la rúbrica o una combinación incompatible, se rechaza con
 * un mensaje que nombra el valor.
 * `cantidad` mayor que `config.simulador_max_conversaciones` se rechaza (antes de llamar a la API).
 * Devuelve { valido, errores, solicitud }.
 */
function validarFormulario(formulario, { config, catalogo }) {
  const f = formulario || {};
  const errores = [];

  const aceptados = config.tipos_interaccion_aceptados || [];
  const tipo = vacio(f.tipo_interaccion) ? aceptados[0] : String(f.tipo_interaccion).trim();
  if (!aceptados.includes(tipo)) errores.push(`tipo_interaccion "${tipo}" no es válido; escribe uno de: ${aceptados.join(', ')} (o déjalo vacío para usar "${aceptados[0]}")`);

  const calidad = vacio(f.calidad_solicitada) ? 'aleatoria' : sinAcentos(f.calidad_solicitada);
  if (!CALIDADES_SOLICITADAS.includes(calidad)) errores.push(`calidad_solicitada "${f.calidad_solicitada}" no es válida; escribe uno de: ${CALIDADES_SOLICITADAS.join(', ')} (o déjala vacía para aleatoria)`);

  let cantidad = 1;
  if (!vacio(f.cantidad)) {
    cantidad = Number(f.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1) errores.push(`cantidad ${JSON.stringify(f.cantidad)} no es válida; escribe un número entero de 1 a ${Number.isInteger(config.simulador_max_conversaciones) ? config.simulador_max_conversaciones : "el máximo configurado (simulador_max_conversaciones)"} (o déjala vacía para 1)`);
  }
  const maximo = config.simulador_max_conversaciones;
  if (Number.isInteger(cantidad) && Number.isInteger(maximo) && cantidad > maximo) {
    errores.push(`cantidad ${cantidad} supera el máximo por ejecución; escribe un número de 1 a ${maximo} (simulador_max_conversaciones)`);
  }

  const lote = validarLoteDestino(f.lote, config);
  errores.push(...lote.errores);

  // Tema: si viene, debe existir en el catálogo (se compara sin acentos ni mayúsculas).
  let tema = null;
  if (!vacio(f.tema)) {
    const filas = catalogoDelTipo(catalogo, tipo);
    const encontrada = filas.find((fila) => sinAcentos(fila.tema) === sinAcentos(f.tema));
    if (encontrada) tema = encontrada.tema;
    else errores.push(`tema "${f.tema}" no está en el catálogo activo de ${tipo}; ${sugerirTemas(filas)}`);
  }

  const criticos = separarLista(f.error_critico);
  const repetidos = criticos.filter((c, i) => criticos.indexOf(c) !== i);
  if (repetidos.length) errores.push(`error_critico repetido: ${[...new Set(repetidos)].join(', ')}; escribe cada error crítico una sola vez`);

  const casos = separarLista(f.casos_dificiles);
  for (const c of casos) if (!CASOS_DIFICILES.includes(c)) errores.push(`casos_dificiles: "${c}" no es un caso difícil del glosario; escribe uno de: ${CASOS_DIFICILES.join(', ')} (varios separados por | o déjalo vacío)`);

  let semilla = null;
  if (!vacio(f.semilla_sorteo)) {
    semilla = Number(f.semilla_sorteo);
    if (!Number.isInteger(semilla) || semilla < 0 || semilla > 4294967295) {
      errores.push(`semilla_sorteo ${JSON.stringify(f.semilla_sorteo)} no es válida; escribe un entero de 0 a 4294967295 o déjala vacía para sorteo automático`);
      semilla = null;
    }
  }

  // Las fallas pedidas se validan contra la rúbrica del tipo (si la config trae su version_reglas).
  const criterios = separarLista(f.criterios_que_deben_fallar);
  if (criterios.length && config.version_reglas) {
    const criticosValidos = CRITICOS_POR_VERSION[config.version_reglas];
    for (const c of criticos) if (criticosValidos && !criticosValidos.includes(c)) errores.push(`error_critico: "${c}" no es un error crítico de ${config.version_reglas}; escribe uno de: ${criticosValidos.join(', ')} (o déjalo vacío)`);
    errores.push(...validarCriteriosPedidos(criterios, { versionReglas: config.version_reglas, criticos, calidad }));
  }

  return {
    valido: errores.length === 0,
    errores,
    solicitud: {
      tipo_interaccion: tipo,
      tema,
      calidad_solicitada: calidad,
      errores_criticos_inyectados: criticos,
      criterios_que_deben_fallar: criterios,
      casos_dificiles: casos,
      cantidad,
      lote: lote.lote,
      semilla_sorteo: semilla,
    },
  };
}

// ---------------------------------------------------------------------------
// IDs y cuenta
// ---------------------------------------------------------------------------

/**
 * Genera `cantidad` IDs CONV-nnnn consecutivos, todos mayores que el mayor existente, por lo que
 * nunca chocan con `idsExistentes` (el pegamento junta los de `escenarios`, `conversaciones` y
 * `revision_humana`). Mínimo 4 dígitos (glosario). Limitación: dos formularios enviados al mismo
 * tiempo podrían leer la misma lista y repetir ID; se asume uso por una sola persona.
 */
function generarIdsConversacion(idsExistentes, cantidad) {
  let maximo = 0;
  for (const id of idsExistentes || []) {
    const m = PATRON_ID_CONVERSACION.exec(String(id));
    if (m) maximo = Math.max(maximo, Number(m[1]));
  }
  const ids = [];
  for (let i = 1; i <= cantidad; i++) ids.push(`CONV-${String(maximo + i).padStart(4, '0')}`);
  return ids;
}

/** Elige una cuenta de la hoja `cuentas` con el generador aleatorio recibido. */
function elegirCuenta(cuentas, aleatorio) {
  return elegirAleatorio(cuentas, aleatorio);
}

/**
 * Tipificación ERRÓNEA para `critico.tipificacion_incorrecta`: una categoría que existe en el
 * catálogo (de otro tema) y que no es válida para el tema del escenario. Nunca una tipificación
 * inventada ni una de las válidas del mismo tema.
 */
function elegirTipificacionErronea(filasCatalogo, tema, aleatorio) {
  const validas = new Set(filasCatalogo.filter((f) => f.tema === tema).map((f) => f.tipificacion_valida));
  const candidatas = [...new Set(filasCatalogo.map((f) => f.tipificacion_valida))].filter((t) => !validas.has(t));
  if (candidatas.length === 0) return null;
  return elegirAleatorio(candidatas, aleatorio);
}

// ---------------------------------------------------------------------------
// Completar el escenario
// ---------------------------------------------------------------------------

/**
 * Completa UN escenario a partir de la solicitud validada.
 *
 * solicitud: la de `validarFormulario`.
 * contexto: { config (del tipo), catalogo, cuentas, conversationId, ahora (Date, por defecto la
 *             hora actual), semilla (entero) } — o, solo para pruebas, `aleatorio` (función) en
 *             lugar de `semilla`.
 *
 * ORDEN FIJO DE LOS SORTEOS (todos con el mismo generador; solo se sortea lo que falta):
 *   1. calidad (si es aleatoria y no hay críticos)   2. tema   3. tipificación (si el tema tiene
 *   varias)   4. cuenta   5. fallas (regular: sección y subelemento por cada una; mala: subelemento)
 *   6. tipificación errónea (si hay critico.tipificacion_incorrecta)   7. fecha de inicio.
 * Misma semilla + mismos datos (config, catálogo, cuentas, ahora) = mismo escenario.
 *
 * Reglas:
 *  - `aleatoria` se resuelve entre buena, regular y mala; con un error crítico pedido, a `mala`.
 *  - Un error crítico con calidad buena o regular es contradictorio: se rechaza.
 *  - Cada error crítico debe existir en la rúbrica de `config.version_reglas`.
 *  - Si el formulario trae `criterios_que_deben_fallar` se usan (validados); si no, se sortean.
 *  - Tipo sin generador (`version_prompt_generador = sin_rubrica`): se rechaza.
 *  - `tipificacion_esperada` es la correcta para el tema. Con `critico.tipificacion_incorrecta` el
 *    AGENTE registra otra (`extras.tipificacion_agente_prevista`).
 *
 * Devuelve { valido, errores, advertencias, escenario, cuenta, extras } con
 * extras = { fecha_hora_inicio, tipificacion_agente_prevista|null, variante_datos_coinciden_sin_critico }
 * (datos para el prompt del generador; no son columnas de `escenarios`).
 */
function completarEscenario(solicitud, contexto) {
  const { config, catalogo, cuentas, conversationId } = contexto;
  const errores = [];
  let advertencias = [];

  let aleatorio = contexto.aleatorio;
  let semilla = null;
  if (!aleatorio) {
    try {
      aleatorio = crearAleatorio(contexto.semilla);
      semilla = contexto.semilla;
    } catch (e) {
      errores.push(e.message);
    }
  }

  const versionGenerador = config.version_prompt_generador;
  if (vacio(versionGenerador) || versionGenerador === 'sin_rubrica') {
    errores.push(`tipo_interaccion "${solicitud.tipo_interaccion}" no tiene prompt de generador (version_prompt_generador = ${versionGenerador}); escoge un tipo_interaccion con generador (por ejemplo "ce")`);
  }
  const criticosRubrica = CRITICOS_POR_VERSION[config.version_reglas];
  if (!criticosRubrica) errores.push(`no hay lista de errores críticos para ${config.version_reglas}; revisa version_reglas en la hoja config (valor recibido: "${config.version_reglas}")`);

  const criticos = solicitud.errores_criticos_inyectados || [];
  if (criticosRubrica) {
    for (const c of criticos) if (!criticosRubrica.includes(c)) errores.push(`error_critico: "${c}" no es un error crítico de ${config.version_reglas}; escribe uno de: ${criticosRubrica.join(', ')} (o déjalo vacío)`);
  }
  if (criticos.length > 0 && ['buena', 'regular'].includes(solicitud.calidad_solicitada)) {
    errores.push(`Contradicción: calidad_solicitada "${solicitud.calidad_solicitada}" con error_critico ${criticos.join(', ')}; un error crítico hace la calidad mala: cambia calidad_solicitada a mala (o aleatoria) o quita el error crítico`);
  }

  const casos = solicitud.casos_dificiles || [];
  for (const c of casos) if (!CASOS_DIFICILES.includes(c)) errores.push(`casos_dificiles: "${c}" no es un caso difícil del glosario; escribe uno de: ${CASOS_DIFICILES.join(', ')} (o déjalo vacío)`);

  const filasCatalogo = catalogoDelTipo(catalogo, solicitud.tipo_interaccion);
  if (filasCatalogo.length === 0) errores.push(`el catálogo no tiene temas activos para tipo_interaccion "${solicitud.tipo_interaccion}"; activa filas de ese tipo en la hoja catalogo_temas (activo = si) o escoge otro tipo_interaccion`);
  if (!cuentas || cuentas.length === 0) errores.push('la hoja cuentas está vacía; agrega al menos una cuenta (datos/cuentas.csv) antes de simular');
  if (errores.length) return { valido: false, errores, advertencias, escenario: null, cuenta: null, extras: null };

  // 1. Calidad
  let calidad = solicitud.calidad_solicitada;
  if (calidad === 'aleatoria') calidad = criticos.length > 0 ? 'mala' : elegirAleatorio(CALIDADES_ESPERADAS, aleatorio);

  // 2. Tema y 3. tipificación
  const temas = [...new Set(filasCatalogo.map((f) => f.tema))];
  const tema = solicitud.tema || elegirAleatorio(temas, aleatorio);
  const tipificaciones = filasCatalogo.filter((f) => f.tema === tema);
  const tipificacion = tipificaciones.length === 1 ? tipificaciones[0] : elegirAleatorio(tipificaciones, aleatorio);

  // 4. Cuenta
  const cuenta = elegirCuenta(cuentas, aleatorio);

  // 5. Fallas: las del formulario (validadas con la calidad ya resuelta) o las sorteadas.
  let criterios = solicitud.criterios_que_deben_fallar || [];
  if (criterios.length > 0) {
    errores.push(...validarCriteriosPedidos(criterios, { versionReglas: config.version_reglas, criticos, calidad }));
    if (errores.length) return { valido: false, errores, advertencias, escenario: null, cuenta: null, extras: null };
  } else {
    const sorteo = sortearFallas({ calidad, criticos, versionReglas: config.version_reglas, config, aleatorio });
    criterios = sorteo.criterios;
    advertencias = advertencias.concat(sorteo.advertencias);
  }

  // 6. Tipificación errónea del agente
  let tipificacionAgente = null;
  if (criticos.includes('critico.tipificacion_incorrecta')) {
    tipificacionAgente = elegirTipificacionErronea(filasCatalogo, tema, aleatorio);
    if (!tipificacionAgente) return { valido: false, errores: ['No hay otra tipificación en el catálogo para usar como tipificación incorrecta'], advertencias, escenario: null, cuenta: null, extras: null };
  }

  // 7. Fecha de inicio
  let fechaInicio;
  try {
    fechaInicio = sortearFechaInicio(config, contexto.ahora || new Date(), aleatorio);
  } catch (e) {
    return { valido: false, errores: [e.message], advertencias, escenario: null, cuenta: null, extras: null };
  }

  const variante = criterios.includes(VARIANTE_SIN_CRITICO) && !criticos.includes('critico.validacion_identidad');
  const partes = [`Conversación de calidad ${calidad} sobre el tema "${tema}" (tipificación correcta: "${tipificacion.tipificacion_valida}").`];
  if (criticos.length) partes.push(`Errores críticos inyectados: ${criticos.join(', ')}.`);
  if (tipificacionAgente) partes.push(`El agente registra la tipificación "${tipificacionAgente}", que existe en el catálogo pero no corresponde al tema.`);
  if (criterios.length) partes.push(`Criterios que deben fallar: ${criterios.join(', ')}.`);
  if (variante) partes.push('Variante sin crítico de identidad.datos_coinciden: el cliente no alcanza el mínimo de datos acertados y el agente no declina, pero tampoco revela información de la cuenta.');
  if (criterios.includes('solucion.informacion_correcta') && !criticos.includes('critico.informacion_incorrecta')) {
    partes.push('La información incorrecta no debe tener impacto (si no, sería error crítico).');
  }
  if (casos.length) partes.push(`Casos difíciles: ${casos.join(', ')}.`);

  return {
    valido: true,
    errores: [],
    advertencias,
    cuenta,
    extras: { fecha_hora_inicio: fechaInicio, tipificacion_agente_prevista: tipificacionAgente, variante_datos_coinciden_sin_critico: variante },
    escenario: {
      conversation_id: conversationId,
      lote: solicitud.lote,
      tipo_interaccion: solicitud.tipo_interaccion,
      generado_por: 'simulador',
      calidad_solicitada: solicitud.calidad_solicitada,
      calidad_esperada: calidad,
      tema_esperado: tema,
      tipificacion_esperada: tipificacion.tipificacion_valida,
      errores_criticos_inyectados: criticos,
      criterios_que_deben_fallar: criterios,
      casos_dificiles: casos,
      descripcion_escenario: partes.join(' '),
      cuenta_id: cuenta.cuenta_id,
      semilla_sorteo: semilla,
    },
  };
}

/**
 * Planifica TODAS las conversaciones pedidas (`solicitud.cantidad`): genera los IDs y completa un
 * escenario por cada una. Si alguna falla no se devuelve ninguna (todo o nada), con los errores
 * sin repetir. Rechaza `cantidad` mayor que `config.simulador_max_conversaciones` antes de sortear.
 *
 * Semillas: la base es `solicitud.semilla_sorteo` (si el dueño la escribió) o `contexto.semillaNueva`
 * (la genera el pegamento con `semillaDesdeAleatorio(Math.random())`). La conversación número i
 * usa base + i, así cada fila de `escenarios` guarda su propia semilla y se reproduce sola.
 * contexto: el de `completarEscenario` más `idsExistentes` y `semillaNueva` (sin `conversationId`
 * ni `semilla`).
 */
function planificarEscenarios(solicitud, contexto) {
  const maximo = contexto.config.simulador_max_conversaciones;
  if (Number.isInteger(maximo) && solicitud.cantidad > maximo) {
    return { valido: false, errores: [`cantidad ${solicitud.cantidad} supera el máximo por ejecución (simulador_max_conversaciones = ${maximo})`], advertencias: [], escenarios: [] };
  }
  const base = solicitud.semilla_sorteo !== null && solicitud.semilla_sorteo !== undefined ? solicitud.semilla_sorteo : contexto.semillaNueva;
  if (!contexto.aleatorio && !Number.isInteger(base)) {
    return { valido: false, errores: ['Falta la semilla del sorteo (semilla_sorteo del formulario o semillaNueva del pegamento)'], advertencias: [], escenarios: [] };
  }
  const ids = generarIdsConversacion(contexto.idsExistentes, solicitud.cantidad);
  const escenarios = [];
  const errores = [];
  const advertencias = [];
  ids.forEach((id, i) => {
    const semilla = contexto.aleatorio ? undefined : (base + i) % 4294967296;
    const r = completarEscenario(solicitud, { ...contexto, conversationId: id, semilla });
    errores.push(...r.errores);
    advertencias.push(...r.advertencias);
    if (r.valido) escenarios.push({ escenario: r.escenario, cuenta: r.cuenta, extras: r.extras });
  });
  const unicos = (lista) => [...new Set(lista)];
  if (errores.length) return { valido: false, errores: unicos(errores), advertencias: unicos(advertencias), escenarios: [] };
  return { valido: true, errores: [], advertencias: unicos(advertencias), escenarios };
}

// ---------------------------------------------------------------------------
// Verificación de la conversación generada (W0, paso 4, después de validarGeneracion)
// ---------------------------------------------------------------------------

/**
 * Comprueba con reglas deterministas que la conversación generada trae lo que el escenario pidió.
 * Si algo no coincide, la salida es INVÁLIDA (`tipo_error = generacion_invalida`) y W0 reintenta
 * hasta `config.reintentos_generacion` veces (el conteo de reintentos lo lleva el workflow).
 *
 *  (a) Tipificación errónea: si el escenario lleva `extras.tipificacion_agente_prevista`,
 *      `metadatos_caso.tipificacion_agente` debe ser exactamente esa.
 *  (b) Variante sin crítico de identidad.datos_coinciden (`extras.variante_datos_coinciden_sin_critico`),
 *      con las mismas cuentas que JS-2/JS-6 (sin el LLM, así que `info_n` se toma como null):
 *        - el agente pidió datos de identidad (si no, datos_coinciden sería no_aplica);
 *        - el cliente NO alcanza `config.identidad_min_datos_correctos` datos acertados;
 *        - el agente no usa frases de declinación (lista `declina_validacion`);
 *        - el agente NO sigue pidiendo datos al final (si no, datos_coinciden sería cumple);
 *        - JS no detecta datos de la cuenta revelados por el agente (parte JS de
 *          critico.confidencialidad: dato completo o parcial fuera del formato permitido).
 *
 * LIMITACIÓN (se devuelve como advertencia, no como error): "el agente no revela información de la
 * cuenta" solo es verificable en lo que JS puede detectar (correo, RFC y teléfono completos o
 * parciales). Datos que no tienen formato (el contenido de facturas, saldos, casos anteriores, el
 * plan contratado) requieren el LLM (`primer_mensaje_info_cuenta`); el simulador no lo llama, así
 * que esa parte queda sin verificar.
 *
 * Sin `require` entre módulos: las funciones de JS-6 se reciben como parámetro.
 * opciones: {
 *   contexto: contexto de JS-1 a JS-3 sobre el payload generado (prepararContexto + extraerYEnmascarar
 *             + evaluarReglasJS): necesita extraccion.detecciones, extraccion.parciales y
 *             resultados_js.variables;
 *   funciones: { calcularIdentidad, revelacionesConfidencialidad } de js/reglas_hibridas.js;
 * }
 * (`config` sale de contexto.config.) Solo hace falta el contexto cuando hay variante de identidad.
 * Devuelve { valido, errores, advertencias, tipo_error } con tipo_error 'generacion_invalida' o null.
 * Los mensajes nombran reglas y números de mensaje, nunca copian texto de la conversación.
 */
function verificarEscenarioGenerado(payload, escenario, extras, opciones = {}) {
  const errores = [];
  const advertencias = [];
  const e = extras || {};

  // (a) Tipificación del agente
  if (e.tipificacion_agente_prevista) {
    const real = payload && payload.metadatos_caso ? payload.metadatos_caso.tipificacion_agente : undefined;
    if (real !== e.tipificacion_agente_prevista) {
      errores.push('La tipificación del agente no es la tipificación incorrecta pedida por el escenario (metadatos_caso.tipificacion_agente)');
    }
  }

  // (b) Variante de identidad sin crítico
  if (e.variante_datos_coinciden_sin_critico) {
    const { contexto, funciones } = opciones;
    if (!contexto || !funciones || typeof funciones.calcularIdentidad !== 'function' || typeof funciones.revelacionesConfidencialidad !== 'function') {
      throw new Error('verificarEscenarioGenerado: la variante de identidad necesita contexto (JS-1 a JS-3) y funciones.calcularIdentidad / funciones.revelacionesConfidencialidad');
    }
    const { config, extraccion, resultados_js: js } = contexto;
    const identidad = funciones.calcularIdentidad({ detecciones: extraccion.detecciones, variables: js.variables, config, infoN: null });
    if (identidad.mensaje_solicitud_n === null) {
      errores.push('Variante de identidad: el agente nunca pide datos de identidad (identidad.datos_coinciden quedaría no_aplica)');
    }
    if (identidad.validacion_exitosa) {
      errores.push(`Variante de identidad: el cliente alcanza el mínimo de datos acertados (${identidad.datos_correctos} de ${config.identidad_min_datos_correctos}, mensaje ${identidad.mensaje_validacion_n}); debe quedarse por debajo`);
    }
    if (identidad.mensajes_declina.length > 0) {
      errores.push(`Variante de identidad: el agente declina la validación (mensaje(s) ${identidad.mensajes_declina.join(', ')}); no debe declinar`);
    }
    if (identidad.sigue_pidiendo_datos) {
      errores.push('Variante de identidad: el agente sigue pidiendo datos de identidad al final (identidad.datos_coinciden quedaría cumple)');
    }
    const reveladas = funciones.revelacionesConfidencialidad({ detecciones: extraccion.detecciones, parciales: extraccion.parciales || [], identidad });
    if (reveladas.length > 0) {
      errores.push(`Variante de identidad: el agente revela datos de la cuenta (mensaje(s) ${[...new Set(reveladas.map((r) => r.n))].join(', ')}); activaría critico.confidencialidad`);
    }
    advertencias.push('No verificable sin LLM: que el agente no revele otra información de la cuenta sin formato de dato (facturas, saldos, casos anteriores, plan contratado). Solo se comprobaron correo, RFC y teléfono.');
  }

  return { valido: errores.length === 0, errores, advertencias, tipo_error: errores.length ? 'generacion_invalida' : null };
}

// ---------------------------------------------------------------------------
// Decisión después de cada intento de generación (W0, paso 4)
// ---------------------------------------------------------------------------

/**
 * Decide qué hace W0 después de generar una conversación, para que los IF del workflow no lleven
 * lógica.
 *
 * Entradas:
 *   lectura            resultado de leerRespuestaGenerador (construccion_prompt.js). Si `completa`
 *                      es false (cortada, rechazo, JSON inválido...), `validacion` y `verificacion`
 *                      llegan null.
 *   validacion         resultado de validarGeneracion (validador_payload.js) o null.
 *   verificacion       resultado de verificarEscenarioGenerado o null (null si el payload no es válido).
 *   intento_generacion intentos ya hechos: empieza en 0.
 *   config             reintentos_generacion.
 *   escenario          fila de verdad del escenario (de él salen conversation_id, lote y tipo).
 *
 * Acciones:
 *   'continuar'            lectura completa, payload válido y verificación válida (las advertencias de
 *                          la verificación NO invalidan). registrar_error = null.
 *   'reintentar'           hay un problema y intento_generacion < config.reintentos_generacion;
 *                          siguiente_intento = intento_generacion + 1.
 *   'generacion_invalida'  hay un problema y ya no quedan reintentos.
 * En las dos últimas, registrar_error tiene la forma de entrada de filaLogErrores (tipo_error
 * generacion_invalida). El detalle nunca lleva texto de la conversación: solo el motivo de la lectura
 * y las rutas y mensajes de las reglas que fallaron.
 */
function decidirIntentoGeneracion({ lectura, validacion, verificacion, intento_generacion: intento = 0, config, escenario }) {
  const detalle = { intento_generacion: intento };
  const causas = [];
  if (!lectura || lectura.completa !== true) {
    const motivo = lectura && lectura.motivo ? lectura.motivo : 'sin_lectura';
    causas.push(`lectura incompleta (${motivo})`);
    detalle.motivo_lectura = motivo;
  } else {
    if (!validacion || validacion.valido !== true) {
      causas.push('el payload generado no cumple el contrato');
      detalle.errores_validacion = ((validacion && validacion.errores) || []).map((e) => ({ ruta: e.ruta, mensaje: e.mensaje }));
    }
    if (verificacion && verificacion.valido !== true) {
      causas.push('la conversación no trae lo que pidió el escenario');
      detalle.errores_verificacion = verificacion.errores || [];
    }
  }
  if (causas.length === 0) return { accion: 'continuar', siguiente_intento: intento, registrar_error: null };

  const maximo = config.reintentos_generacion;
  const reintentar = Number.isInteger(maximo) && intento < maximo;
  const e = escenario || {};
  return {
    accion: reintentar ? 'reintentar' : 'generacion_invalida',
    siguiente_intento: reintentar ? intento + 1 : intento,
    registrar_error: {
      workflow: 'simulador',
      nodo: 'Decidir intento de generación',
      tipo_error: 'generacion_invalida',
      mensaje_error: `Generación inválida en el intento ${intento + 1}: ${causas.join('; ')}${reintentar ? '. Se reintenta.' : '. Sin más reintentos.'}`,
      conversation_id: e.conversation_id,
      lote: e.lote,
      tipo_interaccion: e.tipo_interaccion,
      detalle,
    },
  };
}

// ---------------------------------------------------------------------------
// Filas de hojas
// ---------------------------------------------------------------------------

/** Lista de Sheets: valores separados por | sin espacios. */
function listaParaCelda(lista) {
  return (lista || []).join('|');
}

function enteroOVacio(valor) {
  return Number.isInteger(valor) && valor >= 0 ? valor : '';
}

/**
 * Fila de `escenarios` (19 columnas) con la verdad del escenario.
 * La verdad sale de los PARÁMETROS de W0 (`escenario`), nunca de lo que devuelva el modelo.
 * generacion: { modelo_generador, version_prompt_generador, tokens_entrada, tokens_salida,
 *               costo_generacion_usd (null si precios por_verificar), generado_en (Date o marca) }
 * Un dato desconocido se deja VACÍO (nunca `no_medido`, que solo usa calibracion_v1).
 */
function filaEscenarios(escenario, generacion, config) {
  const generadoEn = generacion.generado_en instanceof Date ? marcaTiempoSistema(generacion.generado_en, config.zona_horaria) : generacion.generado_en;
  const costo = typeof generacion.costo_generacion_usd === 'number' && Number.isFinite(generacion.costo_generacion_usd) ? generacion.costo_generacion_usd : '';
  return {
    conversation_id: escenario.conversation_id,
    lote: escenario.lote,
    tipo_interaccion: escenario.tipo_interaccion,
    generado_por: escenario.generado_por,
    calidad_solicitada: escenario.calidad_solicitada,
    calidad_esperada: escenario.calidad_esperada,
    tema_esperado: escenario.tema_esperado,
    tipificacion_esperada: escenario.tipificacion_esperada,
    errores_criticos_inyectados: listaParaCelda(escenario.errores_criticos_inyectados),
    criterios_que_deben_fallar: listaParaCelda(escenario.criterios_que_deben_fallar),
    casos_dificiles: listaParaCelda(escenario.casos_dificiles),
    descripcion_escenario: escenario.descripcion_escenario,
    cuenta_id: escenario.cuenta_id,
    modelo_generador: generacion.modelo_generador,
    version_prompt_generador: generacion.version_prompt_generador,
    tokens_entrada: enteroOVacio(generacion.tokens_entrada),
    tokens_salida: enteroOVacio(generacion.tokens_salida),
    costo_generacion_usd: costo,
    generado_en: generadoEn,
    semilla_sorteo: Number.isInteger(escenario.semilla_sorteo) ? escenario.semilla_sorteo : '',
  };
}

/**
 * Fila de `revision_humana` (52 columnas) para la calificación a ciegas.
 * Solo lleva datos observables del payload: nada de la verdad del escenario ni de resultados del
 * sistema. Las columnas `h_*`, los comentarios y `calificado_en` van VACÍAS: solo el dueño las
 * llena. `lote` es el del formulario.
 * legibles: { textoLegible, metadatosCasoLegible } de js/texto_legible.js (se reciben como
 * parámetro para no copiar ese código).
 */
function filaRevisionHumana(payload, lote, legibles) {
  const fila = {};
  for (const columna of COLUMNAS_REVISION_HUMANA) fila[columna] = '';
  Object.assign(fila, {
    conversation_id: payload.conversation_id,
    lote,
    tipo_interaccion: payload.tipo_interaccion,
    agente: payload.agente,
    cuenta_id: payload.cuenta_id,
    metadatos_caso_legible: legibles.metadatosCasoLegible(payload.metadatos_caso),
    texto_legible: legibles.textoLegible(payload.mensajes),
    estado_revision: 'pendiente',
  });
  return fila;
}

// ---------------------------------------------------------------------------
// Envío a Ingesta
// ---------------------------------------------------------------------------

/**
 * Copia SOLO los campos del payload del contrato (lista blanca). Aunque el objeto que llegue aquí
 * traiga por error campos del escenario (calidad_esperada, errores_criticos_inyectados...), no
 * pasan al POST. Es la defensa de "la verdad del escenario nunca viaja con la conversación".
 */
function soloPayload(payload) {
  const m = payload.metadatos_caso;
  return {
    conversation_id: payload.conversation_id,
    canal: payload.canal,
    tipo_interaccion: payload.tipo_interaccion,
    agente: payload.agente,
    cuenta_id: payload.cuenta_id,
    metadatos_caso: {
      tipificacion_agente: m.tipificacion_agente,
      numero_caso: m.numero_caso,
      estado_caso: m.estado_caso,
      escalado: m.escalado,
      campos_capturados: { ...m.campos_capturados },
    },
    mensajes: payload.mensajes.map((x) => ({ n: x.n, emisor: x.emisor, timestamp: x.timestamp, texto: x.texto })),
  };
}

/**
 * Arma el POST a Ingesta: URL con `?lote=` y cuerpo = solo el payload.
 * `urlWebhook` es la URL del webhook de Ingesta (la define el workflow, no el contrato).
 */
function armarPostIngesta(payload, lote, urlWebhook) {
  if (!PATRON_LOTE.test(lote || '')) throw new Error(`lote inválido para el POST: ${JSON.stringify(lote)}`);
  if (vacio(urlWebhook)) throw new Error('Falta la URL del webhook de Ingesta');
  return { method: 'POST', url: `${urlWebhook}?lote=${encodeURIComponent(lote)}`, body: soloPayload(payload) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SUBELEMENTOS_POR_VERSION,
    INCOMPATIBLES_CON_CRITICO,
    ACTIVA_CRITICO,
    PARES_EXCLUYENTES,
    VARIANTE_SIN_CRITICO,
    listarSubelementos,
    motivoRechazoCriterio,
    crearAleatorio,
    semillaDesdeAleatorio,
    parsearHorario,
    sortearFechaInicio,
    sortearFallas,
    elegirTipificacionErronea,
    verificarEscenarioGenerado,
    decidirIntentoGeneracion,
    LOTES_CONGELADOS,
    CRITICOS_POR_VERSION,
    COLUMNAS_ESCENARIOS,
    COLUMNAS_REVISION_HUMANA,
    marcaTiempoSistema,
    elegirAleatorio,
    validarLoteDestino,
    validarFormulario,
    generarIdsConversacion,
    elegirCuenta,
    completarEscenario,
    planificarEscenarios,
    filaEscenarios,
    filaRevisionHumana,
    soloPayload,
    armarPostIngesta,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n
 * Pega TODO este archivo (y, para la revisión humana, también js/texto_legible.js) y, debajo,
 * el bloque que corresponda sin comentar.
 *
 * --- W0 paso 2, nodo Code "Completar escenario" (Run Once for All Items) ---
 * const f = $json;                                          // campos del Form Trigger
 * const cfg = $('Config cargada').first().json;             // cargarConfig(filas, <tipo>)
 * const v = validarFormulario(f, { config: cfg, catalogo: $('Leer catalogo').all().map((i) => i.json) });
 * if (!v.valido) throw new Error(v.errores.join(' | '));    // el Error Trigger lo registra
 * const ids = [...$('Leer escenarios').all(), ...$('Leer conversaciones').all()].map((i) => i.json.conversation_id);
 * const p = planificarEscenarios(v.solicitud, { config: cfg, catalogo: $('Leer catalogo').all().map((i) => i.json),
 *   cuentas: $('Leer cuentas').all().map((i) => i.json), idsExistentes: ids, semillaNueva: semillaDesdeAleatorio(Math.random()) });
 * if (!p.valido) throw new Error(p.errores.join(' | '));
 * return p.escenarios.map((e) => ({ json: e }));
 *
 * --- W0 paso 5 (guardar escenario): return { json: filaEscenarios($json.escenario, $json.generacion, cfg) };
 * --- W0 paso 7 (revision_humana):   return { json: filaRevisionHumana($json.payload, $json.escenario.lote, { textoLegible, metadatosCasoLegible }) };
 * --- W0 paso 8 (POST a Ingesta):    return { json: armarPostIngesta($json.payload, $json.escenario.lote, URL_WEBHOOK_INGESTA) };
 *
 * --- W0 paso 4, nodo Code "Decidir intento de generación" (Run Once for Each Item) ---
 * return { json: decidirIntentoGeneracion({ lectura: $json.lectura, validacion: $json.validacion,
 *   verificacion: $json.verificacion, intento_generacion: $json.intento_generacion || 0, config: cfg, escenario: $json.escenario }) };
 * // Switch por `accion`: continuar / reintentar (vuelve a Claude con siguiente_intento) / generacion_invalida.
 * // Con registrar_error no nulo: filaLogErrores(registrar_error + alerta_enviada).
 * ------------------------------------------------------------------------- */
