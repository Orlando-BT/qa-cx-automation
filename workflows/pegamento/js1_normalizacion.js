// JS-1 Normalización (W2). Modo "Run Once for All Items". Fuentes: js/normalizacion.js + js/costo.js.
// La fila de `conversaciones` es la fuente: sus versiones pueden ser las del disparador manual.
const entrada = $('Leer conversación').first().json;
const contexto = prepararContexto({
  payload: payloadDesdeFilaConversaciones(entrada),
  lote: entrada.lote,
  filasConfig: $('Leer hoja config').all().map((i) => i.json),
  filasListas: $('Leer hoja listas').all().map((i) => i.json),
  filasCatalogo: $('Leer hoja catalogo_temas').all().map((i) => i.json),
  filasCuentas: $('Leer hoja cuentas').all().map((i) => i.json),
});
contexto.llave_dedup = entrada.llave_dedup;
contexto.versiones = { version_reglas: entrada.version_reglas, version_prompt: entrada.version_prompt };
contexto.marcas = { recibido_en: entrada.recibido_en, iniciado_en: marcaTiempoSistema(new Date(), contexto.config.zona_horaria) };
return [{ json: contexto }];
