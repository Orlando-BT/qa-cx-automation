// Config de calibración (W1, disparador manual). Modo "Run Once for All Items".
// Fuente: js/normalizacion.js. Filas `todos`: zona horaria, alertas y tope de costo del lote.
const filas = $('Leer config (calibración)').all().map((i) => i.json);
return [{ json: cargarConfig(filas) }];
