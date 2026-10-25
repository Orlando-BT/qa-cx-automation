// Armar alerta operativa (cadena común). Modo "Run Once for Each Item". Fuente: js/alertas.js.
// Usa el tipo_error ya validado por filaLogErrores y el id_error para citar el registro.
const f = $('Fila log_errores').item.json;
const datos = { ...f.aux_error.registrar_error, tipo_error: f.tipo_error, id_error: f.id_error };
return { json: { ...armarAlertaOperativa(datos), config: f.aux_error.config } };
