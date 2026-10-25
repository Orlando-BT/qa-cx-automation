// Verificar escenario generado (W0, paso 4). Modo "Run Once for Each Item".
// Fuentes: js/simulador.js + js/reglas_hibridas.js (sus funciones se pasan como parámetro).
// El contexto de verificación trae datos sin enmascarar: no sigue en el ítem.
const { contexto_verificacion: contexto, ...item } = $json;
const verificacion = verificarEscenarioGenerado(item.payload, item.escenario, item.extras, {
  contexto,
  funciones: { calcularIdentidad, revelacionesConfidencialidad },
});
return { json: { ...item, verificacion } };
