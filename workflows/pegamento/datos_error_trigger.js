// Datos del error (99 Errores). Modo "Run Once for All Items". Fuente: js/registro_errores.js.
// analizarErrorTrigger traduce la salida del Error Trigger; si identifica una conversación de W2
// (llave_dedup en el mensaje), devuelve actualizacion_conversacion para pasarla a reproceso.
const config = $('Config cargada').first().json;
const r = analizarErrorTrigger($('Disparador de errores').first().json, '', { config, ahora: new Date() });
const { actualizacion_conversacion, ...registrar_error } = r;
const enviar_alerta = debeAlertar(registrar_error.tipo_error, config);
return [{ json: { registrar_error, enviar_alerta, config, actualizacion_conversacion } }];
