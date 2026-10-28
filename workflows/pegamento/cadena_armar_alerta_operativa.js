// Armar alerta operativa (cadena común), rama "sí" de "¿Enviar alerta operativa?".
// Modo "Run Once for Each Item". Fuente: js/alertas.js. $json = salida de "Fila log_errores":
// usa el tipo_error ya validado por filaLogErrores y el id_error con el que se escribirá la fila.
const f = $json;
const datos = { ...f.registrar_error, tipo_error: f.tipo_error, id_error: f.id_error };
return { json: { ...armarAlertaOperativa(datos), config: f.config } };
