const test = require('node:test');
const assert = require('node:assert/strict');

const { contextoHastaJS3 } = require('./ayudas');
const { payloadBase } = require('./fixtures');

/** Enmascara una conversación corta y devuelve la extracción. */
function extraer(lista) {
  return contextoHastaJS3(payloadBase(lista)).extraccion;
}
const textos = (ex) => ex.mensajes_enmascarados.map((m) => m.texto);

test('correo completo → [EMAIL_n], comparado sin distinguir mayúsculas', () => {
  const ex = extraer([
    ['cliente', 0, 'Mi correo es Hector.Villanueva@TaqueriaLosArcos.example, gracias.'],
    ['agente', 30, 'Gracias.'],
  ]);
  assert.equal(textos(ex)[0], 'Mi correo es [EMAIL_1], gracias.');
  const d = ex.detecciones.find((x) => x.tipo === 'correo');
  assert.equal(d.coincide_cuenta, true);
});

test('RFC completo en minúsculas también se enmascara; mismo valor → mismo marcador', () => {
  const ex = extraer([
    ['cliente', 0, 'Mi RFC es tla190211qm2.'],
    ['agente', 30, 'Confirmo el RFC TLA190211QM2 y otro RFC GOMA850101AB3.'],
  ]);
  assert.equal(textos(ex)[0], 'Mi RFC es [RFC_1].');
  assert.equal(textos(ex)[1], 'Confirmo el RFC [RFC_1] y otro RFC [RFC_2].');
  assert.equal(ex.detecciones.find((d) => d.marcador === '[RFC_2]').coincide_cuenta, false);
});

test('teléfono con espacios, guiones o paréntesis → [TELEFONO_n]', () => {
  const ex = extraer([
    ['cliente', 0, 'Tel (55) 5456-7804, otro 55 1234 5678 y 5512345678.'],
    ['agente', 30, 'Gracias.'],
  ]);
  assert.equal(textos(ex)[0], 'Tel [TELEFONO_1], otro [TELEFONO_2] y [TELEFONO_2].');
  assert.equal(ex.detecciones[0].coincide_cuenta, true, '5554567804 es el teléfono de CTA-104');
});

test('canales oficiales (correo y teléfono) NO se enmascaran', () => {
  const ex = extraer([
    ['cliente', 0, 'Hola'],
    ['agente', 30, 'Escríbenos a Soporte@contamix.example o llama al 55 5000 1000.'],
  ]);
  assert.equal(textos(ex)[1], 'Escríbenos a Soporte@contamix.example o llama al 55 5000 1000.');
  assert.ok(ex.detecciones.every((d) => d.es_oficial));
});

test('nombre del titular: completo, nombre de pila + apellido y nombre de pila solo → mismo [NOMBRE_1], sin acentos', () => {
  const ex = extraer([
    ['cliente', 0, 'Soy HECTOR VILLANUEVA RUIZ.'],
    ['agente', 30, 'Hola Héctor Ruiz, ¿cómo estás, héctor?'],
    ['cliente', 60, 'Bien. Habla Héctor Villanueva.'],
  ]);
  assert.deepEqual(textos(ex), ['Soy [NOMBRE_1].', 'Hola [NOMBRE_1], ¿cómo estás, [NOMBRE_1]?', 'Bien. Habla [NOMBRE_1].']);
  assert.deepEqual(ex.detecciones.map((d) => d.forma), ['completo', 'pila_apellido', 'pila', 'pila_apellido']);
});

test('el nombre de pila del agente no se enmascara en sus mensajes aunque coincida con el titular', () => {
  const payload = payloadBase([
    ['cliente', 0, 'Hola, soy Héctor.'],
    ['agente', 30, 'Hola, soy Héctor, tu asesor.'],
  ]);
  payload.agente = 'Héctor Pérez';
  const ex = contextoHastaJS3(payload).extraccion;
  assert.equal(ex.mensajes_enmascarados[0].texto, 'Hola, soy [NOMBRE_1].');
  assert.equal(ex.mensajes_enmascarados[1].texto, 'Hola, soy Héctor, tu asesor.');
});

test('datos enmascarados parcialmente por el agente no se reemplazan y se analizan contra la cuenta', () => {
  const ex = extraer([
    ['cliente', 0, 'Hola'],
    ['agente', 30, 'Tu correo h***@taquerialosarcos.example, teléfono ******7804 y RFC *********QM2.'],
  ]);
  assert.equal(textos(ex)[1], 'Tu correo h***@taquerialosarcos.example, teléfono ******7804 y RFC *********QM2.');
  assert.deepEqual(
    ex.parciales.map((p) => [p.tipo, p.corresponde_cuenta, p.visibles, p.formato_permitido]),
    [
      ['correo', true, 1, true],
      ['rfc', true, 3, true],
      ['telefono', true, 4, true],
    ]
  );
  // Más visibles que lo permitido.
  const ex2 = extraer([
    ['cliente', 0, 'Hola'],
    ['agente', 30, 'Tu correo he***@taquerialosarcos.example'],
  ]);
  assert.equal(ex2.parciales[0].formato_permitido, false);
  // Un parcial que no corresponde a la cuenta se marca así (JS-6 lo ignora).
  const ex3 = extraer([
    ['cliente', 0, 'Hola'],
    ['agente', 30, 'Teléfono ******9999'],
  ]);
  assert.equal(ex3.parciales[0].corresponde_cuenta, false);
});

test('números de caso: se extraen y no se enmascaran', () => {
  const ex = extraer([
    ['cliente', 0, 'Hola'],
    ['agente', 30, 'Tu número de caso es CASO-58213.'],
  ]);
  assert.equal(textos(ex)[1], 'Tu número de caso es CASO-58213.');
  assert.deepEqual(ex.numeros_caso, [{ n: 2, emisor: 'agente', valor: 'CASO-58213' }]);
});

test('RFC genéricos del SAT (config.rfc_genericos_permitidos) NO se enmascaran; el RFC del receptor y el de la cuenta sí', () => {
  const ex = extraer([
    ['cliente', 0, 'Facturé a XAXX010101000 y a xexx010101000; el receptor es GOMA850101AB3 y yo soy TLA190211QM2.'],
    ['agente', 30, 'Gracias.'],
  ]);
  assert.equal(textos(ex)[0], 'Facturé a XAXX010101000 y a xexx010101000; el receptor es [RFC_1] y yo soy [RFC_2].');
  const genericos = ex.detecciones.filter((d) => d.es_oficial);
  assert.deepEqual(genericos.map((d) => d.valor_normalizado), ['XAXX010101000', 'XEXX010101000']);
  assert.equal(ex.detecciones.find((d) => d.marcador === '[RFC_1]').coincide_cuenta, false, 'RFC del receptor: no es el de la cuenta');
  assert.equal(ex.detecciones.find((d) => d.marcador === '[RFC_2]').coincide_cuenta, true, 'RFC de la cuenta');
});

test('la lista de RFC genéricos sale de config: quitar uno hace que se enmascare', () => {
  const ex = contextoHastaJS3(payloadBase([['cliente', 0, 'Uso XAXX010101000 o XEXX010101000.'], ['agente', 30, 'Gracias.']]), { configCambios: { rfc_genericos_permitidos: 'XEXX010101000' } }).extraccion;
  assert.equal(textos(ex)[0], 'Uso [RFC_1] o XEXX010101000.');
});
