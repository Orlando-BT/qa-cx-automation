// Fila log_errores (cadena común de W0, W1, W2, W4 y 99 Errores). Modo "Run Once for Each Item".
// Fuente: js/registro_errores.js. Entrada: { registrar_error, enviar_alerta, config } (lo decide js/).
// aux_error no es columna: la escritura en Sheets lo ignora y los nodos siguientes lo usan.
const d = $json;
const datos = { ...d.registrar_error, alerta_enviada: d.enviar_alerta === true, consecutivo: $itemIndex + 1 };
return { json: { ...filaLogErrores(datos, d.config, new Date()), aux_error: d } };
