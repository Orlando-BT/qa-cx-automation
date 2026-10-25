// Pruebas del resumen en consola del modo lote de
// prompts/verificacion/verificar_openai.mjs (sin llamar a la API).
// Todos los datos son FICTICIOS y se construyen aquí: esta prueba nunca lee
// prompts/verificacion/_privado/ ni datos/lotes/*/_escenarios.json.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RUTA_SCRIPT = path.join(__dirname, '..', '..', 'prompts', 'verificacion', 'verificar_openai.mjs');
const cargar = () => import(pathToFileURL(RUTA_SCRIPT).href);

// Valores de concordancia ficticios y fáciles de reconocer en el texto.
function resultadosFicticios() {
  return {
    ejecucion: { conversaciones_solicitadas: 3, conversaciones_evaluadas: 3, respuestas_validas_al_final: 3 },
    consumo: { tokens_entrada: 111, tokens_salida: 22, tokens_totales: 133, costo_total_usd: 0.000123 },
    concordancia_con_escenario: {
      conversaciones_comparadas: 3,
      criterios_coincidentes_pct: { total: { pct: 87.65, coinciden: 4321, total: 4930 } },
      criticos: { esperados: 7771, detectados: 7772, coincidencias: 7773, falsos_positivos: 7774, falsos_negativos: 7775 },
      diferencia_promedio_absoluta_nota_final: 12.34,
      criticos_solo_llm: { total: 9991, coinciden_con_esperado: 9992 },
    },
    notas: ['nota ficticia'],
  };
}
const VALORES_CONCORDANCIA = ['87.65', '4321', '4930', '7771', '7772', '7773', '7774', '7775', '12.34', '9991', '9992'];
const CLAVES_CONCORDANCIA = ['criterios_coincidentes_pct', 'falsos_positivos', 'falsos_negativos', 'diferencia_promedio_absoluta_nota_final', 'criticos_solo_llm', 'conversaciones_comparadas'];

test('importar el script no ejecuta el programa principal', async () => {
  const mod = await cargar();
  assert.equal(typeof mod.resumenConsola, 'function');
  assert.equal(typeof mod.leerArgumentos, 'function');
});

test('sin la opción: solo ejecucion y consumo, nada de concordancia', async () => {
  const { resumenConsola } = await cargar();
  for (const opciones of [undefined, {}, { mostrarConcordancia: false }, { mostrarConcordancia: 'true' }, { mostrarConcordancia: 1 }]) {
    const texto = resumenConsola(resultadosFicticios(), opciones);
    assert.ok(!/concordancia/i.test(texto), `no debe decir "concordancia" (opciones ${JSON.stringify(opciones)})`);
    for (const v of VALORES_CONCORDANCIA) assert.ok(!texto.includes(v), `no debe incluir el valor ${v}`);
    for (const k of CLAVES_CONCORDANCIA) assert.ok(!texto.includes(k), `no debe incluir la clave ${k}`);
    assert.ok(texto.includes('"ejecucion"'));
    assert.ok(texto.includes('"consumo"'));
    assert.ok(texto.includes('0.000123'));
    assert.ok(!texto.includes('nota ficticia'));
  }
});

test('con la opción: incluye concordancia_con_escenario y sus valores', async () => {
  const { resumenConsola } = await cargar();
  const texto = resumenConsola(resultadosFicticios(), { mostrarConcordancia: true });
  assert.ok(texto.includes('"concordancia_con_escenario"'));
  for (const v of VALORES_CONCORDANCIA) assert.ok(texto.includes(v), `debe incluir el valor ${v}`);
  assert.ok(texto.includes('"ejecucion"'));
  assert.ok(texto.includes('"consumo"'));
});

test('resumenConsola no modifica los resultados que recibe', async () => {
  const { resumenConsola } = await cargar();
  const r = resultadosFicticios();
  const copia = JSON.parse(JSON.stringify(r));
  resumenConsola(r);
  resumenConsola(r, { mostrarConcordancia: true });
  assert.deepEqual(r, copia);
});

test('leerArgumentos: la opción solo se activa con --mostrar-concordancia exacto', async () => {
  const { leerArgumentos } = await cargar();
  assert.equal(leerArgumentos([]).mostrarConcordancia, false);
  assert.equal(leerArgumentos(['--prueba-b', '--lote', 'demo']).mostrarConcordancia, false);
  assert.equal(leerArgumentos(['--prueba-b', '--lote', 'demo', '--mostrar-concordancia']).mostrarConcordancia, true);
  assert.equal(leerArgumentos(['--mostrar-concordancia', '--prueba-b']).mostrarConcordancia, true);
  for (const variante of [
    '--mostrar-concordancia=true', '--Mostrar-Concordancia', '--MOSTRAR-CONCORDANCIA', '-mostrar-concordancia',
    'mostrar-concordancia', '--mostrar_concordancia', '--mostrar-concordancia ', ' --mostrar-concordancia',
    '--mostrar', '--concordancia', '--mostrar-concordancias',
  ]) {
    assert.equal(leerArgumentos(['--prueba-b', variante]).mostrarConcordancia, false, `no debe activarse con "${variante}"`);
  }
  // Como valor de otra opción no cuenta como bandera.
  const a = leerArgumentos(['--lote', '--mostrar-concordancia']);
  assert.equal(a.lote, '--mostrar-concordancia');
  assert.equal(a.mostrarConcordancia, false);
});
