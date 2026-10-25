// Config general (W0). Modo "Run Once for All Items". Fuente: js/normalizacion.js.
// Config para validar el formulario: si el tipo_interaccion viene vacío, solo las filas `todos`.
const form = $('Formulario del simulador').first().json;
const filas = $('Leer hoja config').all().map((i) => i.json);
return [{ json: cargarConfig(filas, form.tipo_interaccion) }];
