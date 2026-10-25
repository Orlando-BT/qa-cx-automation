// Completar escenario (W0, paso 2). Modo "Run Once for All Items". Fuente: js/simulador.js.
// Los IDs existentes salen de escenarios, conversaciones y revision_humana (solo conversation_id).
const solicitud = $('Validar formulario').first().json.solicitud;
const hojas = ['Leer hoja escenarios', 'Leer hoja conversaciones', 'Leer hoja revision_humana'];
const ids = hojas.flatMap((n) => $(n).all().map((i) => i.json.conversation_id));
const plan = planificarEscenarios(solicitud, {
  config: $('Config cargada').first().json,
  catalogo: $('Leer hoja catalogo_temas').all().map((i) => i.json),
  cuentas: $('Leer hoja cuentas').all().map((i) => i.json),
  idsExistentes: ids,
  semillaNueva: semillaDesdeAleatorio(Math.random()),
});
return [{ json: plan }];
