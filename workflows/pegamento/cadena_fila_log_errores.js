// Fila log_errores (cadena común de W0, W1, W2, W4 y 99 Errores). Modo "Run Once for Each Item".
// Fuente: js/registro_errores.js. Entrada: { registrar_error, enviar_alerta, config } (lo decide js/).
// Aquí NO se escribe: fija la hora, el consecutivo, el id_error y el tipo_error validado para que la
// alerta cite el mismo id_error que tendrá la fila. La fila se escribe después del Telegram, con el
// resultado real del envío ("Fila log_errores (tras el envío)" o "(sin alerta)").
const d = $json;
const ahora = new Date();
const consecutivo = $itemIndex + 1;
const fila = filaLogErrores({ ...d.registrar_error, alerta_enviada: false, consecutivo }, d.config, ahora);
const base = { registrar_error: d.registrar_error, enviar_alerta: d.enviar_alerta === true, config: d.config };
return { json: { ...base, ahora: ahora.toISOString(), consecutivo, id_error: fila.id_error, tipo_error: fila.tipo_error } };
