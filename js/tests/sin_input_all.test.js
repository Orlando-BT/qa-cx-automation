/**
 * n8n 2.32.6 revisa el texto COMPLETO (comentarios incluidos) de un nodo Code en modo
 * "Run Once for Each Item" y lanza "Can't use .all() here" si encuentra esta expresión.
 * Como los módulos de js/ se pegan en nodos por ítem, ninguno puede contenerla ni en comentarios.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PATRON = /\$input\.(first|last|all|itemMatching)/;
const CARPETA = path.join(__dirname, '..');

test('ningún .js de js/ contiene $input.first/last/all/itemMatching (ni en comentarios)', () => {
  const archivos = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.js'));
  assert.ok(archivos.length > 10);
  const malos = [];
  for (const f of archivos) {
    fs.readFileSync(path.join(CARPETA, f), 'utf8').split('\n').forEach((linea, i) => {
      if (PATRON.test(linea)) malos.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(malos, []);
});
