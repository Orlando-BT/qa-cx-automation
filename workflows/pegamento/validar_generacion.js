// Validar generación (W0, paso 4). Modo "Run Once for Each Item". Fuente: js/validador_payload.js.
// conversation_id y cuenta_id los fija el escenario, no el modelo.
const item = $json;
const r = validarGeneracion(item.salida_generador, {
  fijos: { conversation_id: item.escenario.conversation_id, cuenta_id: item.escenario.cuenta_id },
  cuentas: $('Leer hoja cuentas').all().map((i) => i.json),
  config: item.config,
});
return { json: { ...item, payload: r.payload, valido: r.valido, errores: r.errores } };
