// Fila de revisión humana (W0, paso 7). Modo "Run Once for Each Item".
// Fuentes: js/simulador.js + js/texto_legible.js. Sin verdad del escenario ni resultados; lote del formulario.
const item = $('Decidir intento de generación').item.json;
return { json: filaRevisionHumana(item.payload, item.escenario.lote, { textoLegible, metadatosCasoLegible }) };
