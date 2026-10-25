// Clasificar respuesta Claude (W0). Modo "Run Once for Each Item". Fuente: js/clasificacion_http.js.
// El HTTP Request va con respuesta completa y "nunca fallar": $json = { statusCode, headers, body }
// o, ante error de red/timeout (salida de error del nodo), un objeto sin statusCode.
const contexto = $('Preparar llamada Claude').item.json;
const respuesta = $json;
const clasificacion = clasificarRespuestaHttp(respuesta, contexto.intento_conexion || 0, contexto.config);
return { json: { ...contexto, respuesta_http: respuesta, clasificacion_http: clasificacion } };
