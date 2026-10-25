// Config cargada (W1). Modo "Run Once for All Items". Fuente: js/normalizacion.js (cargarConfig).
// Con un tipo_interaccion ausente o inválido solo se cargan las filas `todos`, que bastan para
// validar el payload (lote_por_defecto, canales_habilitados, tipos_interaccion_aceptados).
const cuerpo = $('Webhook de ingesta').first().json.body || {};
const filas = $('Leer hoja config').all().map((i) => i.json);
return [{ json: cargarConfig(filas, cuerpo.tipo_interaccion) }];
