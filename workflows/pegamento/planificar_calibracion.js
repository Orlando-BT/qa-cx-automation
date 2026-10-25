// Planificar calibración (W1, disparador manual). Modo "Run Once for All Items". Fuente: js/ingesta.js.
const config = $('Config de calibración').first().json;
const filas = $('Leer conversaciones del lote').all().map((i) => i.json);
const p = $('Parámetros de calibración').first().json; // lote, version_reglas, version_prompt
const plan = planificarCalibracionManual({ ...p, filasConversaciones: filas, config, ahora: new Date() });
return [{ json: plan }];
