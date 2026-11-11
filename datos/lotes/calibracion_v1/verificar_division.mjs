// Genera (con --escribir) o verifica la division ajuste/validacion de calibracion_v1.
// Algoritmo: se agrupan los IDs por calidad_esperada (de _escenarios.json), se ordenan
// ascendente, se barajan con Fisher-Yates usando mulberry32 (crearAleatorio de js/simulador.js,
// solo lectura) iniciado una sola vez con la semilla, en el orden buena, regular, mala.
// Los primeros 4 de cada grupo son ajuste y los otros 4 validacion.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const aqui = dirname(fileURLToPath(import.meta.url));
const { crearAleatorio } = require(join(aqui, '..', '..', '..', 'js', 'simulador.js'));

const SEMILLA = 20261111;
const CALIDADES = ['buena', 'regular', 'mala'];
const ruta = join(aqui, 'division_ajuste_validacion.json');

const escenarios = JSON.parse(readFileSync(join(aqui, '_escenarios.json'), 'utf8'));
const calidadDe = Object.fromEntries(escenarios.map((e) => [e.conversation_id, e.calidad_esperada]));

function dividir(semilla) {
  const azar = crearAleatorio(semilla);
  const ajuste = [], validacion = [];
  for (const c of CALIDADES) {
    const ids = Object.keys(calidadDe).filter((id) => calidadDe[id] === c).sort();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(azar() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    ajuste.push(...ids.slice(0, 4));
    validacion.push(...ids.slice(4, 8));
  }
  return { ajuste: ajuste.sort(), validacion: validacion.sort() };
}

if (process.argv.includes('--escribir')) {
  const d = dividir(SEMILLA);
  const salida = {
    advertencia: 'SUPUESTO DE DISENO (Fase 4, decision 7): la division es una eleccion de diseno, no un hecho de los datos. Con 12 conversaciones por mitad, las metricas son orientativas, no concluyentes. El lote calibracion_v1 sigue congelado; este archivo no modifica conversaciones ni escenarios.',
    lote: 'calibracion_v1',
    semilla: SEMILLA,
    metodo: 'Estratificado por calidad_esperada (_escenarios.json). Por calidad: IDs ordenados ascendente, Fisher-Yates con mulberry32 (crearAleatorio de js/simulador.js), un solo generador iniciado con la semilla, calidades en orden buena, regular, mala; los 4 primeros van a ajuste y los 4 restantes a validacion. Listas finales ordenadas.',
    ajuste: d.ajuste,
    validacion: d.validacion,
    calidad_por_id: Object.fromEntries([...d.ajuste, ...d.validacion].sort().map((id) => [id, calidadDe[id]])),
  };
  writeFileSync(ruta, JSON.stringify(salida, null, 2) + '\n');
}

// Verificacion
const f = JSON.parse(readFileSync(ruta, 'utf8'));
let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fallos++; };
const todos = [...f.ajuste, ...f.validacion];
ok(f.ajuste.length === 12 && f.validacion.length === 12, '12 ajuste y 12 validacion');
ok(!f.ajuste.some((id) => f.validacion.includes(id)), 'sin traslape');
ok(new Set(todos).size === 24, '24 IDs unicos');
const archivos = readdirSync(aqui).filter((n) => /^CONV-\d+\.json$/.test(n)).map((n) => n.replace('.json', ''));
ok(todos.every((id) => archivos.includes(id)) && archivos.length === 24, 'IDs coinciden con las 24 conversaciones del lote');
for (const [nombre, lista] of [['ajuste', f.ajuste], ['validacion', f.validacion]]) {
  const cuenta = CALIDADES.map((c) => lista.filter((id) => calidadDe[id] === c).length);
  ok(cuenta.every((n) => n === 4), `${nombre} 4/4/4 (buena/regular/mala = ${cuenta.join('/')})`);
}
const r = dividir(f.semilla);
ok(JSON.stringify(r.ajuste) === JSON.stringify(f.ajuste) && JSON.stringify(r.validacion) === JSON.stringify(f.validacion), `reproduce desde la semilla ${f.semilla}`);
console.log(fallos === 0 ? 'VERIFICACION APROBADA' : `VERIFICACION FALLIDA (${fallos})`);
process.exit(fallos ? 1 : 0);
