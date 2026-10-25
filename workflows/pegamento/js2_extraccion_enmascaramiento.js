// JS-2 Extracción y enmascaramiento (W2). Modo "Run Once for All Items". Fuente: js/enmascaramiento.js.
// Toma el contexto de JS-1 (el nodo anterior es la escritura del estado en Sheets).
// contexto.extraccion.detecciones contiene valores reales: no escribirla en Sheets ni en logs.
const contexto = $('JS-1 Normalización').first().json;
contexto.extraccion = extraerYEnmascarar(contexto);
return [{ json: contexto }];
