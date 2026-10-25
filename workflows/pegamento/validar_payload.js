// Validar payload (W1, paso 2). Modo "Run Once for All Items". Fuente: js/validador_payload.js.
// El IF siguiente manda los inválidos a log_errores (tipo_error = payload_invalido) con alerta.
const w = $('Webhook de ingesta').first().json;
const config = $('Config cargada').first().json;
const cuentas = $('Leer hoja cuentas').all().map((i) => i.json);
const lote = validarLote(w.query && w.query.lote, config);
const resultado = validarPayload(w.body, { cuentas, config });
const errores = [...resultado.errores, ...lote.errores];
return [{ json: { payload: w.body, lote: lote.lote, valido: resultado.valido && lote.valido, errores } }];
