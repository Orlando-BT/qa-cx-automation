// Planificar escritura (W2). Modo "Run Once for All Items". Fuente: js/costo.js.
// Escritura idempotente: una fila por llave_dedup en evaluaciones y una por id_evaluacion +
// id_criterio en detalle_criterios. Solo se escribe lo que todavía no está en Sheets.
const evaluacion = $('JS-8 Costo').first().json.evaluacion;
const plan = planificarEscrituraResultados({
  evaluacion,
  filasEvaluacionesExistentes: $('Leer evaluaciones de la llave').all().map((i) => i.json),
  filasDetalleExistentes: $('Leer detalle de la evaluación').all().map((i) => i.json),
});
return [{ json: plan }];
