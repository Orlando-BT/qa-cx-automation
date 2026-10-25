// Config cargada (W0). Modo "Run Once for All Items". Fuente: js/normalizacion.js.
// Config del tipo ya resuelto por validarFormulario (precedencia del tipo sobre `todos`).
const solicitud = $('Validar formulario').first().json.solicitud;
const filas = $('Leer hoja config').all().map((i) => i.json);
return [{ json: cargarConfig(filas, solicitud.tipo_interaccion) }];
