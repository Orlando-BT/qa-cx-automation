// Construir petición generador (W0, paso 3a). Modo "Run Once for Each Item".
// Fuente: js/construccion_prompt.js (construirPeticionGenerador). anthropic-version va en el HTTP.
const item = $input.item.json;
const cuerpo = construirPeticionGenerador({
  plantilla: $('Plantilla generador').first().json.plantilla_generador,
  esquema: $('Esquema generador').first().json.esquema_generador,
  valores: item.valores_generador,
  config: item.config,
});
return { json: { ...item, peticion_claude: cuerpo, intento_conexion: 0 } };
