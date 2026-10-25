// Config cargada (W4 y 99 Errores). Modo "Run Once for All Items". Fuente: js/normalizacion.js.
// Filas `todos`: zona horaria, destinatario de Telegram, reproceso y alertas.
const filas = $('Leer hoja config').all().map((i) => i.json);
return [{ json: cargarConfig(filas) }];
