// Preparar reintento OpenAI (W2), accion = reintentar_validacion. Modo "Run Once for Each Item".
// Fuente: js/construccion_prompt.js (prepararReintento). La llamada nueva empieza sin reintentos de conexión.
const item = $input.item.json;
return { json: { ...item, ...prepararReintento(item), intento_conexion: 0 } };
