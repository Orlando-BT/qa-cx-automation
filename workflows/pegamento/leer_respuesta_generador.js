// Leer respuesta generador (W0, paso 3b). Modo "Run Once for Each Item".
// Fuente: js/construccion_prompt.js (leerRespuestaGenerador). La decisión la toma decidirIntentoGeneracion.
const item = $input.item.json; // salida de "Clasificar respuesta Claude" (accion = continuar)
const lectura = leerRespuestaGenerador(item.respuesta_http.body);
return { json: { ...item, texto_generado: lectura.texto, salida_generador: lectura.salida, lectura_generador: lectura } };
