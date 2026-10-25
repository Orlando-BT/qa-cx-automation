// Verificación: JS-2 Extracción y enmascaramiento (W0, paso 4). Modo "Run Once for Each Item".
// Fuente: js/enmascaramiento.js.
const item = $json;
item.contexto_verificacion.extraccion = extraerYEnmascarar(item.contexto_verificacion);
return { json: item };
