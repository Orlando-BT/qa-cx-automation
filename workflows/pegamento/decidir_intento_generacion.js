// Decidir intento de generación (W0, paso 4). Modo "Run Once for Each Item". Fuente: js/simulador.js.
// El Switch siguiente lee decision.accion: continuar, reintentar o generacion_invalida.
const item = $json;
const decision = decidirIntentoGeneracion({
  lectura: item.lectura_generador,
  validacion: { valido: item.valido, errores: item.errores, payload: item.payload },
  verificacion: item.verificacion || null,
  intento_generacion: item.intento_generacion,
  config: item.config,
  escenario: item.escenario,
});
return { json: { ...item, decision } };
