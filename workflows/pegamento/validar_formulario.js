// Validar formulario (W0, paso 2). Modo "Run Once for All Items". Fuente: js/simulador.js.
// Rechaza calibracion_v1 (lote congelado) y cantidad > simulador_max_conversaciones antes de la API.
const form = $('Formulario del simulador').first().json;
const config = $('Config general').first().json;
const catalogo = $('Leer hoja catalogo_temas').all().map((i) => i.json);
return [{ json: validarFormulario(form, { config, catalogo }) }];
