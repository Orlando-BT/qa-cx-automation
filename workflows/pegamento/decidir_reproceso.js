// Decidir reproceso (W4). Modo "Run Once for Each Item". Fuente: js/ingesta.js.
// El Switch siguiente lee accion: reenviar, pasar_a_error o ignorar. config viaja para la cadena de errores.
const config = $('Config cargada').first().json;
return { json: { ...decidirReproceso($json, config, new Date()), config } };
