// Fila log_errores (formulario) (W0), rechazo del formulario. Modo "Run Once for Each Item".
// Fuente: js/registro_errores.js. Este camino no tiene Telegram (formulario_invalido no alerta):
// alerta_enviada = no. Devuelve solo las 11 columnas de log_errores.
const d = $json;
return { json: filaLogErrores({ ...d.registrar_error, alerta_enviada: false, consecutivo: $itemIndex + 1 }, d.config, new Date()) };
