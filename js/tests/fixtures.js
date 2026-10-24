/**
 * Fixtures construidos a mano a partir de contrato/ejemplos/ y de los casos de
 * contrato/rubrica.md. Son ficticios (cuenta CTA-104 de datos/cuentas.csv).
 * Cuando exista el lote calibracion_v1 se agregarán pruebas sobre esas conversaciones.
 */

/** Convierte segundos desde las 10:00:00 en timestamp del contrato. */
function ts(segundos) {
  const base = Date.UTC(2026, 9, 21, 10, 0, 0) + segundos * 1000;
  return new Date(base).toISOString().slice(0, 19);
}

/** Arma mensajes desde [emisor, segundos, texto]. */
function mensajes(lista) {
  return lista.map(([emisor, seg, texto], i) => ({ n: i + 1, emisor, timestamp: ts(seg), texto }));
}

/**
 * Conversación "buena" de cancelación de CFDI. Cumple todos los criterios [JS].
 * Agente: Mariana López. Titular de CTA-104: Héctor Villanueva Ruiz.
 */
const CONVERSACION_BUENA = [
  ['cliente', 0, 'Hola, necesito cancelar una factura que emití por error.'],
  ['agente', 40, '¡Hola! Bienvenido a Contamix, soy Mariana. Con gusto te ayudo con la cancelación. Te informo que tus datos personales están protegidos conforme a nuestro aviso de privacidad. ¿Con quién tengo el gusto?'],
  ['cliente', 70, 'Soy Héctor Villanueva Ruiz.'],
  ['agente', 90, 'Gracias, Héctor. Para validar tu identidad, ¿me compartes tu RFC y el correo registrado?'],
  ['cliente', 120, 'Claro, mi RFC es TLA190211QM2 y el correo hector.villanueva@taquerialosarcos.example'],
  ['agente', 150, 'Gracias, la validación fue correcta. Veo en tu cuenta la factura con folio A-1050 emitida ayer. ¿Me confirmas el UUID y el motivo de cancelación?'],
  ['cliente', 190, 'El UUID es el que termina en 4F2A y el motivo es 02, comprobante con errores sin relación.'],
  ['agente', 220, 'Perfecto. Entra a Facturación > Facturas emitidas, elige la factura, da clic en Cancelar y selecciona el motivo 02. Registré tu caso con el número CASO-58213.'],
  ['cliente', 270, 'Listo, ya quedó cancelada. Gracias.'],
  ['agente', 290, 'Excelente, quedó aplicada la solución: cancelaste la factura con motivo 02 y tu caso CASO-58213 queda cerrado. ¿Hay algo más en lo que te pueda ayudar? Nuestro centro de ayuda está disponible de lunes a viernes y la promoción de cierre fiscal sigue vigente.'],
  ['cliente', 320, 'No, es todo.'],
  ['agente', 340, 'Gracias por contactar a Contamix. Te invito a responder la breve encuesta de satisfacción. Soy Mariana, que tengas un excelente día.'],
];

function payloadBase(listaMensajes, metadatos = {}) {
  return {
    conversation_id: 'CONV-0101',
    canal: 'chat',
    tipo_interaccion: 'ce',
    agente: 'Mariana López',
    cuenta_id: 'CTA-104',
    metadatos_caso: {
      tipificacion_agente: 'Cancelación de CFDI',
      numero_caso: 'CASO-58213',
      estado_caso: 'cerrado',
      escalado: false,
      campos_capturados: { uuid_factura: 'presente', motivo_cancelacion: 'presente' },
      ...metadatos,
    },
    mensajes: mensajes(listaMensajes),
  };
}

function payloadBueno(metadatos) {
  return payloadBase(CONVERSACION_BUENA, metadatos);
}

/** Copia de la conversación buena con el mensaje `n` (1-based) reemplazado. */
function conMensaje(n, [emisor, seg, texto]) {
  const copia = CONVERSACION_BUENA.map((m) => [...m]);
  copia[n - 1] = [emisor ?? copia[n - 1][0], seg ?? copia[n - 1][1], texto ?? copia[n - 1][2]];
  return copia;
}

const criterioLLM = (resultado, mensajesN, justificacion = 'Juicio de prueba.') => ({ resultado, mensajes: resultado === 'no_aplica' ? [] : mensajesN, justificacion });
const criticoNo = () => ({ detectado: false, mensajes: [], justificacion: 'Sin evidencia en los mensajes del agente.' });

/** Salida del LLM coherente con CONVERSACION_BUENA (forma de llm_output.schema.json). */
function llmBueno() {
  return {
    tema: { valor: 'Cancelación de CFDI', mensajes: [1], justificacion: 'El cliente pide cancelar una factura.' },
    emocion_cliente: { emocion: 'preocupacion', mensajes: [1], justificacion: 'Emitió una factura por error.' },
    criterios: {
      empatia: {
        identifica_emocion: criterioLLM('cumple', [2]),
        muestra_empatia: criterioLLM('cumple', [2]),
        cordialidad: criterioLLM('cumple', [2, 12]),
        lenguaje_acorde: criterioLLM('cumple', [2]),
        asertividad: criterioLLM('no_aplica', []),
      },
      diagnostico: {
        preguntas_necesarias: criterioLLM('cumple', [6]),
        solicitudes_detectadas: criterioLLM('cumple', [2]),
        solicitudes_atendidas: criterioLLM('cumple', [8]),
      },
      solucion: {
        informacion_correcta: criterioLLM('cumple', [8]),
        informacion_completa: criterioLLM('cumple', [8]),
        apego_proceso: criterioLLM('cumple', [8]),
        ofrece_alternativas: criterioLLM('no_aplica', []),
      },
      comunicacion: {
        redaccion: criterioLLM('cumple', [8]),
        congruencia: criterioLLM('cumple', [8]),
      },
      recapitulacion: { recapitula: criterioLLM('cumple', [10]) },
    },
    insumos_hibridos: {
      situacion_escalamiento: { situacion_requiere_escalamiento: false, mensajes: [1], justificacion: 'KB-02: la cancelación la hace el cliente.' },
      uso_solucion_seguimiento: { problema_resuelto_en_conversacion: true, uso_correcto: true, mensajes: [10], justificacion: 'Dice solución y el problema se resolvió.' },
    },
    errores_ortografia: [],
    primer_mensaje_info_cuenta: { mensaje_n: 6, justificacion: 'Menciona la factura de la cuenta.' },
    solicitudes_cliente: [
      { descripcion: 'Cancelar una factura', mensaje_n: 1, detectada_por_agente: true, atendida: true, mensajes_atencion: [8], justificacion: 'Explica el proceso.' },
    ],
    articulos_base_usados: [{ id_articulo: 'KB-02', mensajes: [8], justificacion: 'Proceso de cancelación.' }],
    criticos_posibles: {
      informacion_incorrecta: criticoNo(),
      promesa_no_autorizada: criticoNo(),
      negacion_servicio: criticoNo(),
      mala_actitud: criticoNo(),
      comentarios_negativos_marca: criticoNo(),
      confidencialidad: criticoNo(),
    },
  };
}

module.exports = { ts, mensajes, CONVERSACION_BUENA, payloadBase, payloadBueno, conMensaje, llmBueno };
