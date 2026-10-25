// Decidir ingesta (W1). Modo "Run Once for All Items". Fuente: js/ingesta.js.
// El Switch siguiente lee accion: insertar, reutilizar, sin_rubrica o duplicado.
const v = $('Validar payload').first().json;
const config = $('Config cargada').first().json;
const existentes = $('Leer conversaciones existentes').all().map((i) => i.json);
const decision = decidirIngesta({ payload: v.payload, lote: v.lote, config, filasExistentes: existentes, ahora: new Date() });
return [{ json: decision }];
