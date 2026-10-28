// Fila log_errores (sin alerta) (cadena común), rama "no" de "¿Enviar alerta operativa?".
// Modo "Run Once for Each Item". Fuente: js/registro_errores.js. No hubo Telegram: alerta_enviada = no.
// Misma hora y consecutivo que "Fila log_errores". Devuelve solo las 11 columnas de log_errores.
const f = $json;
return { json: filaLogErrores({ ...f.registrar_error, alerta_enviada: false, consecutivo: f.consecutivo }, f.config, new Date(f.ahora)) };
