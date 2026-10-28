// Fila log_errores (tras el envío) (cadena común), después de registrar la alerta en `alertas`.
// Modo "Run Once for Each Item". Fuente: js/registro_errores.js.
// Misma hora y consecutivo que "Fila log_errores": el id_error es el que citó la alerta.
// alerta_enviada = resultado real: estado_envio es 'enviada' solo si Telegram salió por la salida
// normal con ok = true (estadoEnvio de js/alertas.js); por la salida de error es 'fallida'.
// Devuelve solo las 11 columnas de log_errores (nada auxiliar llega a la hoja).
const f = $('Fila log_errores').item.json;
const enviada = $('Fila alertas (operativa)').item.json.estado_envio === 'enviada';
return { json: filaLogErrores({ ...f.registrar_error, alerta_enviada: enviada, consecutivo: f.consecutivo }, f.config, new Date(f.ahora)) };
