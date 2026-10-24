/**
 * Texto legible para revisión humana (Workflow 0 Simulador, paso 6, y carga inicial de
 * `revision_humana`).
 *
 * Formatos exactos de contrato/sheets.md (hoja `revision_humana`):
 *  - `texto_legible`: una línea por mensaje, en orden, con el formato
 *        [n] HH:MM:SS emisor: texto
 *    No se enmascara: es la hoja privada del dueño y los datos son ficticios.
 *  - `metadatos_caso_legible`:
 *        tipificacion_agente: <valor> | numero_caso: <valor o sin caso> | estado_caso: <valor>
 *        | escalado: si/no | campos_capturados: <campo>=<presente/ausente>, ...
 *
 * Por qué: el dueño califica a ciegas leyendo la conversación tal como la vería un
 * supervisor; no debe ver resultados del sistema ni la verdad del escenario, por eso aquí
 * solo se usan datos observables del payload.
 */

/**
 * Una línea por mensaje. Supuesto: si un texto trae saltos de línea, se reemplazan por un
 * espacio para respetar "una línea por mensaje".
 */
function textoLegible(mensajes) {
  return [...mensajes]
    .sort((a, b) => a.n - b.n)
    .map((m) => {
      const hora = String(m.timestamp).slice(11, 19); // HH:MM:SS de YYYY-MM-DDTHH:MM:SS
      const texto = String(m.texto).replace(/\s*\r?\n\s*/g, ' ');
      return `[${m.n}] ${hora} ${m.emisor}: ${texto}`;
    })
    .join('\n');
}

/** Metadatos del caso en una línea, con el formato de sheets.md. */
function metadatosCasoLegible(metadatos) {
  const campos = Object.entries(metadatos.campos_capturados || {})
    .map(([campo, estado]) => `${campo}=${estado}`)
    .join(', ');
  return [
    `tipificacion_agente: ${metadatos.tipificacion_agente}`,
    `numero_caso: ${metadatos.numero_caso === null ? 'sin caso' : metadatos.numero_caso}`,
    `estado_caso: ${metadatos.estado_caso}`,
    `escalado: ${metadatos.escalado ? 'si' : 'no'}`,
    `campos_capturados: ${campos}`,
  ].join(' | ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { textoLegible, metadatosCasoLegible };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "Texto legible", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * const payload = $json.payload;                 // payload ya validado (paso 4)
 * return {
 *   json: {
 *     ...$json,
 *     texto_legible: textoLegible(payload.mensajes),
 *     metadatos_caso_legible: metadatosCasoLegible(payload.metadatos_caso),
 *   },
 * };
 * ------------------------------------------------------------------------- */
