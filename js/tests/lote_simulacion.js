/**
 * Simulación EXPLÍCITA de la salida del LLM para el lote calibracion_v1, construida solo
 * con lo que declara `_escenarios.json` (uso exclusivo de pruebas; ningún código de
 * producción lee ese archivo). No es una predicción del LLM real: sirve para comprobar
 * que, si el LLM entregara los juicios que el escenario asume, JS-6 y JS-7 producen las
 * secciones, críticos y notas esperadas.
 *
 * Reglas de la simulación:
 *  - Criterios [LLM]: no_cumple si están en criterios_que_deben_fallar; si no, cumple.
 *    asertividad y ofrece_alternativas no se pueden inferir del escenario: no_aplica.
 *  - tema = tema_esperado. Escalamiento: requiere si el escenario hace fallar
 *    escala_cuando_requiere, o si el agente escaló y no se hace fallar no_escala_innecesario.
 *  - uso_correcto = false solo si el escenario hace fallar uso_solucion_seguimiento.
 *  - Ortografía: un error grave en el primer mensaje del agente si el escenario hace
 *    fallar comunicacion.ortografia.
 *  - info_n: mensaje del agente indicado en mensajes_criticos_inyectados para
 *    critico.validacion_identidad; si el crítico está inyectado sin mensaje, el primer
 *    mensaje del agente después de la primera respuesta del cliente a la solicitud; si
 *    no, y el agente pidió datos, el primer mensaje del agente posterior a la validación
 *    (si se alcanza); si no, null.
 *  - diagnostico.numero_preguntas depende del mensaje de atención simulado: no se compara.
 *  - Críticos [LLM]: detectado si están en errores_criticos_inyectados, con sus mensajes.
 *    La parte LLM de confidencialidad queda en false: así se prueba solo la parte JS.
 */
const { calcularIdentidad, CRITERIOS_LLM } = require('../reglas_hibridas');

const NO_INFERIBLES = ['empatia.asertividad', 'solucion.ofrece_alternativas'];
const CRITICOS_LLM = ['informacion_incorrecta', 'promesa_no_autorizada', 'negacion_servicio', 'mala_actitud', 'comentarios_negativos_marca', 'confidencialidad'];

const separar = (texto) => String(texto || '').split('|').filter(Boolean);

function llmSimulado(escenario, contexto) {
  const fallar = new Set(separar(escenario.criterios_que_deben_fallar));
  const inyectados = new Set(separar(escenario.errores_criticos_inyectados));
  const msgCrit = escenario.mensajes_criticos_inyectados || {};
  const agente = contexto.conversacion.mensajes_agente;
  const cliente = contexto.conversacion.mensajes_cliente;
  const primero = agente[0];
  const meta = contexto.payload.metadatos_caso;
  const variables = contexto.resultados_js.variables;

  const criterios = {};
  for (const id of CRITERIOS_LLM) {
    const [s, sub] = id.split('.');
    criterios[s] = criterios[s] || {};
    const resultado = fallar.has(id) ? 'no_cumple' : NO_INFERIBLES.includes(id) ? 'no_aplica' : 'cumple';
    criterios[s][sub] = { resultado, mensajes: resultado === 'no_aplica' ? [] : [primero], justificacion: 'Simulado desde el escenario.' };
  }

  let infoN = null;
  const evidenciaIdentidad = (msgCrit['critico.validacion_identidad'] || []).filter((n) => agente.includes(n));
  if (evidenciaIdentidad.length) infoN = evidenciaIdentidad[0];
  else if (inyectados.has('critico.validacion_identidad') && variables.mensaje_solicitud_n !== null) {
    // Crítico inyectado sin mensaje declarado: la información llega en el primer mensaje
    // del agente después de la primera respuesta del cliente a la solicitud.
    const respuesta = cliente.find((n) => n > variables.mensaje_solicitud_n);
    infoN = respuesta ? agente.find((n) => n > respuesta) ?? null : null;
  } else if (variables.mensaje_solicitud_n !== null) {
    const id = calcularIdentidad({ detecciones: contexto.extraccion.detecciones, variables, config: contexto.config, infoN: null });
    if (id.mensaje_validacion_n !== null) infoN = agente.find((n) => n > id.mensaje_validacion_n) ?? null;
  }

  const requiere = fallar.has('solucion.escala_cuando_requiere') || (meta.escalado === true && !fallar.has('solucion.no_escala_innecesario'));
  const criticos = {};
  for (const c of CRITICOS_LLM) {
    const id = `critico.${c}`;
    const detectado = c !== 'confidencialidad' && inyectados.has(id);
    criticos[c] = detectado
      ? { detectado: true, mensajes: (msgCrit[id] || []).filter((n) => agente.includes(n)), justificacion: 'Simulado desde el escenario.' }
      : { detectado: false, mensajes: [], justificacion: 'Sin evidencia.' };
  }

  return {
    tema: { valor: escenario.tema_esperado, mensajes: [cliente[0]], justificacion: 'Simulado.' },
    emocion_cliente: { emocion: 'neutral', mensajes: [], justificacion: 'Simulado.' },
    criterios,
    insumos_hibridos: {
      situacion_escalamiento: { situacion_requiere_escalamiento: requiere, mensajes: [cliente[0]], justificacion: 'Simulado.' },
      uso_solucion_seguimiento: {
        problema_resuelto_en_conversacion: meta.estado_caso === 'cerrado',
        uso_correcto: !fallar.has('recapitulacion.uso_solucion_seguimiento'),
        mensajes: [],
        justificacion: 'Simulado.',
      },
    },
    errores_ortografia: fallar.has('comunicacion.ortografia') ? [{ mensaje_n: primero, texto_error: 'x', correccion: 'y', gravedad: 'grave' }] : [],
    primer_mensaje_info_cuenta: { mensaje_n: infoN, justificacion: 'Simulado.' },
    solicitudes_cliente: [
      { descripcion: 'Simulada', mensaje_n: cliente[0], detectada_por_agente: true, atendida: true, mensajes_atencion: agente.length > 1 ? [agente[1]] : [primero], justificacion: 'Simulado.' },
    ],
    articulos_base_usados: [],
    criticos_posibles: criticos,
  };
}

module.exports = { llmSimulado, separar };
