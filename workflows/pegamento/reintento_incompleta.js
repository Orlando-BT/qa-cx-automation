// Reintento por respuesta incompleta (W2), accion = reintentar_incompleta. Modo "Run Once for Each Item".
// Fuente: js/construccion_prompt.js (prepararReintentoIncompleta): la misma petición, inmediata.
const item = $input.item.json;
return { json: { ...item, ...prepararReintentoIncompleta(item), intento_conexion: 0 } };
