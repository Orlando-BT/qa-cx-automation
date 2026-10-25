// =============================================================================
// ensamblar.mjs — arma los workflows de n8n a partir de plantillas + js/ + pegamento.
// -----------------------------------------------------------------------------
// Dueño: subagente workflows-n8n. Node 20+ sin dependencias.
//
// Por qué existe: la lógica vive SOLO en js/ (y los prompts en prompts/ y contrato/).
// Un nodo Code de n8n no puede hacer require() de archivos locales, así que el código se
// copia dentro del JSON del workflow. Este script hace esa copia de forma determinista
// para que nunca haya dos versiones de la misma regla.
//
// Uso:
//   node workflows/herramientas/ensamblar.mjs              escribe workflows/<nombre>.json
//   node workflows/herramientas/ensamblar.mjs --verificar  compara sin escribir (código ≠ 0 si difiere)
//   node workflows/herramientas/ensamblar.mjs --local      copias importables con valores reales
//                                                          en workflows/_local/ (gitignored)
//
// Marcadores en las plantillas (workflows/plantillas/*.json):
//   - Nodo Code (parameters.jsCode), solo líneas de comentario al inicio:
//         // FUENTE: js/reglas.js                 (una o varias, en orden)
//         // PEGAMENTO: pegamento/js3_reglas_deterministas.js   (exactamente una)
//   - Nodo Set (campo notes del nodo), una línea por campo a rellenar:
//         RELLENO plantilla_evaluador <- prompts/evaluador_ce_v1.md
//     El valor se copia en modo fijo (sin "=" al inicio). Si la asignación es de tipo
//     "object", el archivo debe ser JSON válido.
//
// Cómo queda un nodo Code generado:
//   encabezado "GENERADO..." + los marcadores (para poder recalcularlo desde el JSON
//   exportado) + cada archivo de js/ completo y literal, envuelto en una función que
//   recibe un `module` propio (así dos archivos pueden declarar `const exportados` sin
//   chocar) + la desestructuración de lo que exporta + el pegamento.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ_REPO = resolve(AQUI, '..', '..');

export const MARCADOR_CREDENCIAL = '<ASIGNAR_EN_N8N>';
export const LIMITE_LINEAS_PEGAMENTO = 15;

const RE_FUENTE = /^\/\/ FUENTE: (js\/[A-Za-z0-9_]+\.js)\s*$/;
const RE_PEGAMENTO = /^\/\/ PEGAMENTO: (pegamento\/[A-Za-z0-9_]+\.js)\s*$/;
const RE_RELLENO = /^RELLENO ([A-Za-z0-9_]+) <- ((?:prompts|contrato)\/[A-Za-z0-9_./-]+)\s*$/;
const RE_MARCADOR_VALOR = /<[A-Z][A-Z0-9_]+>/g;

const TIPO_CODE = 'n8n-nodes-base.code';
const TIPO_SET = 'n8n-nodes-base.set';

export class ErrorEnsamblado extends Error {
  constructor(problemas) {
    super(problemas.map((p) => `- ${p}`).join('\n'));
    this.problemas = problemas;
  }
}

// --- utilidades -----------------------------------------------------------------

/** Lee un archivo de texto y normaliza saltos de línea a LF (git en Windows puede dar CRLF). */
export function leerTexto(ruta) {
  return readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n');
}

/** Serialización estable con la que se escriben y comparan los workflows. */
export function serializar(workflow) {
  return JSON.stringify(workflow, null, 2) + '\n';
}

/** Líneas que cuentan como código: ni vacías ni solo comentario. */
export function contarLineasEfectivas(texto) {
  let enBloque = false;
  let n = 0;
  for (const cruda of texto.replace(/\r\n/g, '\n').split('\n')) {
    let linea = cruda.trim();
    if (enBloque) {
      const fin = linea.indexOf('*/');
      if (fin === -1) continue;
      enBloque = false;
      linea = linea.slice(fin + 2).trim();
    }
    if (linea.startsWith('/*')) {
      const fin = linea.indexOf('*/', 2);
      if (fin === -1) {
        enBloque = true;
        continue;
      }
      linea = linea.slice(fin + 2).trim();
    }
    if (linea === '' || linea.startsWith('//')) continue;
    n += 1;
  }
  return n;
}

/** Lee los marcadores del bloque de comentarios inicial de un jsCode. */
export function leerMarcadoresCode(jsCode) {
  const fuentes = [];
  const pegamentos = [];
  for (const linea of String(jsCode || '').replace(/\r\n/g, '\n').split('\n')) {
    const t = linea.trim();
    if (t === '') continue;
    if (!t.startsWith('//')) break; // fin del encabezado
    const f = t.match(RE_FUENTE);
    if (f) fuentes.push(f[1]);
    const p = t.match(RE_PEGAMENTO);
    if (p) pegamentos.push(p[1]);
  }
  return { fuentes, pegamentos };
}

/** Lee los marcadores RELLENO del campo notes de un nodo Set. */
export function leerMarcadoresSet(nodo) {
  const rellenos = [];
  for (const linea of String(nodo.notes || '').replace(/\r\n/g, '\n').split('\n')) {
    const m = linea.trim().match(RE_RELLENO);
    if (m) rellenos.push({ campo: m[1], ruta: m[2] });
  }
  return rellenos;
}

/** Módulo de un archivo de js/ (se carga con Node solo para conocer lo que exporta). */
function cargarModulo(rutaAbs) {
  const requerir = createRequire(pathToFileURL(rutaAbs));
  return requerir(rutaAbs) || {};
}

/** Texto comparable de un valor exportado (funciones por su código fuente). */
function huella(valor) {
  return typeof valor === 'function' ? `fn:${String(valor)}` : `val:${JSON.stringify(valor)}`;
}

function nombreVariable(rutaFuente) {
  return '__fuente_' + rutaFuente.replace(/^js\//, '').replace(/\.js$/, '').replace(/[^A-Za-z0-9_]/g, '_');
}

// --- nodos Code -----------------------------------------------------------------

/**
 * Genera el jsCode de un nodo Code desde sus marcadores. Determinista: el mismo repo da
 * siempre el mismo texto.
 */
export function generarCodigo({ fuentes, pegamento }, raiz = RAIZ_REPO) {
  const problemas = [];
  if (fuentes.length === 0) problemas.push('no tiene ninguna línea "// FUENTE: js/<archivo>.js"');
  if (!pegamento) problemas.push('no tiene la línea "// PEGAMENTO: pegamento/<archivo>.js"');
  if (problemas.length) throw new ErrorEnsamblado(problemas);

  const partes = [];
  partes.push(`// GENERADO, no editar en n8n; fuente: ${fuentes.join(' + ')} + workflows/${pegamento}`);
  partes.push('// Para cambiar este nodo edita esos archivos y corre: node workflows/herramientas/ensamblar.mjs');
  for (const f of fuentes) partes.push(`// FUENTE: ${f}`);
  partes.push(`// PEGAMENTO: ${pegamento}`);
  partes.push('');

  const vistos = new Map();
  for (const f of fuentes) {
    const abs = join(raiz, ...f.split('/'));
    if (!existsSync(abs)) throw new ErrorEnsamblado([`no existe ${f}`]);
    const contenido = leerTexto(abs).replace(/\n+$/, '');
    const modulo = cargarModulo(abs);
    // Un nombre repetido entre dos FUENTE solo se acepta si es la MISMA copia (mismo código
    // fuente, como marcaTiempoSistema, que js/ duplica a propósito y prueba que es igual):
    // se usa la primera. Si difieren, el ensamblado se detiene.
    const nombres = [];
    for (const n of Object.keys(modulo)) {
      if (vistos.has(n)) {
        if (vistos.get(n).huella !== huella(modulo[n])) {
          throw new ErrorEnsamblado([`${f} y ${vistos.get(n).archivo} exportan el mismo nombre "${n}" con distinto contenido`]);
        }
        continue;
      }
      vistos.set(n, { archivo: f, huella: huella(modulo[n]) });
      nombres.push(n);
    }
    const v = nombreVariable(f);
    partes.push(`// ===== INICIO ${f} (copia literal) =====`);
    partes.push(`const ${v} = ((module) => {`);
    partes.push(contenido);
    partes.push('return module.exports;');
    partes.push('})({ exports: {} });');
    partes.push(`// ===== FIN ${f} =====`);
    if (nombres.length) partes.push(`const { ${nombres.join(', ')} } = ${v};`);
    partes.push('');
  }

  const absPeg = join(raiz, 'workflows', ...pegamento.split('/'));
  if (!existsSync(absPeg)) throw new ErrorEnsamblado([`no existe workflows/${pegamento}`]);
  partes.push(`// ===== INICIO workflows/${pegamento} =====`);
  partes.push(leerTexto(absPeg).replace(/\n+$/, ''));
  partes.push(`// ===== FIN workflows/${pegamento} =====`);
  return partes.join('\n') + '\n';
}

// --- nodos Set ------------------------------------------------------------------

function asignacionesDe(nodo) {
  const a = nodo.parameters && nodo.parameters.assignments && nodo.parameters.assignments.assignments;
  return Array.isArray(a) ? a : null;
}

/** Valor que debe tener un campo RELLENO (texto del archivo, LF, sin salto final extra). */
export function valorRelleno(ruta, tipo, raiz = RAIZ_REPO) {
  const abs = join(raiz, ...ruta.split('/'));
  if (!existsSync(abs)) throw new ErrorEnsamblado([`no existe ${ruta}`]);
  const texto = leerTexto(abs).replace(/\n+$/, '') + '\n';
  if (tipo === 'object') {
    try {
      JSON.parse(texto);
    } catch (e) {
      throw new ErrorEnsamblado([`${ruta} no es JSON válido y el campo es de tipo object`]);
    }
  }
  return texto;
}

// --- ensamblado -----------------------------------------------------------------

/**
 * Devuelve una copia del workflow con cada nodo Code y Set marcado recalculado desde el
 * repo. Sirve igual para una plantilla que para un workflow ya generado o exportado de n8n
 * (los marcadores se conservan en el resultado).
 */
export function ensamblarWorkflow(plantilla, raiz = RAIZ_REPO) {
  const wf = JSON.parse(JSON.stringify(plantilla));
  const problemas = [];
  for (const nodo of wf.nodes || []) {
    try {
      if (nodo.type === TIPO_CODE) {
        const { fuentes, pegamentos } = leerMarcadoresCode(nodo.parameters && nodo.parameters.jsCode);
        if (pegamentos.length > 1) throw new ErrorEnsamblado(['tiene más de una línea PEGAMENTO']);
        nodo.parameters.jsCode = generarCodigo({ fuentes, pegamento: pegamentos[0] }, raiz);
      } else if (nodo.type === TIPO_SET) {
        const rellenos = leerMarcadoresSet(nodo);
        if (rellenos.length === 0) continue;
        const asign = asignacionesDe(nodo);
        if (!asign) throw new ErrorEnsamblado(['tiene RELLENO pero no parameters.assignments.assignments']);
        for (const r of rellenos) {
          const a = asign.find((x) => x.name === r.campo);
          if (!a) throw new ErrorEnsamblado([`RELLENO ${r.campo}: no hay una asignación con ese nombre`]);
          a.value = valorRelleno(r.ruta, a.type, raiz);
        }
      }
    } catch (e) {
      const lista = e instanceof ErrorEnsamblado ? e.problemas : [e.message];
      for (const p of lista) problemas.push(`nodo "${nodo.name}": ${p}`);
    }
  }
  if (problemas.length) throw new ErrorEnsamblado(problemas);
  return wf;
}

// --- reglas de la carpeta workflows/ ----------------------------------------------

/**
 * Revisa un workflow (generado o exportado) y devuelve la lista de problemas:
 *   - nodo Code sin marcadores FUENTE/PEGAMENTO;
 *   - pegamento con más de LIMITE_LINEAS_PEGAMENTO líneas efectivas;
 *   - nodo Code que no compila;
 *   - texto de un Set marcado con "{{", "${" o que empieza con "=";
 *   - credencial con id distinto de <ASIGNAR_EN_N8N> (solo si exigirMarcadores).
 */
export function revisarWorkflow(wf, { raiz = RAIZ_REPO, exigirMarcadores = true } = {}) {
  const problemas = [];
  const FuncionAsincrona = Object.getPrototypeOf(async function () {}).constructor;
  for (const nodo of wf.nodes || []) {
    const n = `nodo "${nodo.name}"`;
    if (nodo.type === TIPO_CODE) {
      const codigo = (nodo.parameters && nodo.parameters.jsCode) || '';
      const { fuentes, pegamentos } = leerMarcadoresCode(codigo);
      if (fuentes.length === 0 || pegamentos.length !== 1) {
        problemas.push(`${n}: nodo Code sin marcadores FUENTE/PEGAMENTO (toda lógica va en js/)`);
      } else {
        const abs = join(raiz, 'workflows', ...pegamentos[0].split('/'));
        if (existsSync(abs)) {
          const lineas = contarLineasEfectivas(leerTexto(abs));
          if (lineas > LIMITE_LINEAS_PEGAMENTO) {
            problemas.push(`${n}: workflows/${pegamentos[0]} tiene ${lineas} líneas efectivas (máximo ${LIMITE_LINEAS_PEGAMENTO})`);
          }
        }
      }
      try {
        // n8n ejecuta el código dentro de una función asíncrona (permite return y await).
        new FuncionAsincrona('$', '$input', '$json', '$now', codigo);
      } catch (e) {
        problemas.push(`${n}: el código no compila (${e.message})`);
      }
    }
    if (nodo.type === TIPO_SET) {
      const rellenos = leerMarcadoresSet(nodo);
      const asign = asignacionesDe(nodo) || [];
      for (const r of rellenos) {
        const a = asign.find((x) => x.name === r.campo);
        const v = a && typeof a.value === 'string' ? a.value : '';
        if (v.includes('{{')) problemas.push(`${n}: el campo ${r.campo} contiene "{{" (n8n lo leería como expresión)`);
        if (v.includes('${')) problemas.push(`${n}: el campo ${r.campo} contiene "\${"`);
        if (v.startsWith('=')) problemas.push(`${n}: el campo ${r.campo} empieza con "=" (n8n lo leería como expresión)`);
      }
    }
    if (exigirMarcadores && nodo.credentials) {
      for (const [tipo, cred] of Object.entries(nodo.credentials)) {
        if (!cred || cred.id !== MARCADOR_CREDENCIAL) {
          problemas.push(`${n}: la credencial ${tipo} no usa el marcador ${MARCADOR_CREDENCIAL}`);
        }
      }
    }
  }
  return problemas;
}

/** Diferencias de los nodos marcados entre un workflow y su recálculo desde el repo. */
export function diferenciasMarcadas(wf, raiz = RAIZ_REPO) {
  const esperado = ensamblarWorkflow(wf, raiz);
  const diferencias = [];
  const porNombre = new Map((esperado.nodes || []).map((x) => [x.name, x]));
  for (const nodo of wf.nodes || []) {
    const e = porNombre.get(nodo.name);
    if (nodo.type === TIPO_CODE) {
      const actual = nodo.parameters.jsCode;
      const deseado = e.parameters.jsCode;
      if (actual !== deseado) diferencias.push({ nodo: nodo.name, archivo: segmentoDistinto(actual, deseado) });
    } else if (nodo.type === TIPO_SET) {
      for (const r of leerMarcadoresSet(nodo)) {
        const a = (asignacionesDe(nodo) || []).find((x) => x.name === r.campo);
        const b = (asignacionesDe(e) || []).find((x) => x.name === r.campo);
        if (!a || !b || a.value !== b.value) diferencias.push({ nodo: nodo.name, archivo: r.ruta });
      }
    }
  }
  return diferencias;
}

/** Indica qué archivo (js/ o pegamento) explica la diferencia de un jsCode. */
function segmentoDistinto(actual, deseado) {
  const trozos = (texto) => {
    const mapa = new Map();
    const re = /\/\/ ===== INICIO (\S+)[^\n]*\n([\s\S]*?)\/\/ ===== FIN \1 =====/g;
    let m;
    while ((m = re.exec(texto || ''))) mapa.set(m[1], m[2]);
    return mapa;
  };
  const a = trozos(actual);
  const d = trozos(deseado);
  const distintos = [...d.keys()].filter((k) => a.get(k) !== d.get(k));
  return distintos.length ? distintos.join(', ') : 'encabezado o código fuera de las secciones marcadas';
}

// --- valores locales (--local) ------------------------------------------------------

/**
 * Sustituye marcadores <MAYUSCULAS> por valores reales y asigna IDs de credencial por nombre.
 * Solo se usa para escribir en workflows/_local/. Devuelve { workflow, sinValor }.
 */
export function aplicarValoresLocales(wf, valores) {
  const copia = JSON.parse(JSON.stringify(wf));
  const marcadores = (valores && valores.marcadores) || {};
  const credenciales = (valores && valores.credenciales) || {};
  const sinValor = new Set();
  const recorrer = (x) => {
    if (typeof x === 'string') {
      return x.replace(RE_MARCADOR_VALOR, (m) => {
        if (m === MARCADOR_CREDENCIAL) return m;
        if (Object.prototype.hasOwnProperty.call(marcadores, m) && marcadores[m] !== '') return String(marcadores[m]);
        sinValor.add(m);
        return m;
      });
    }
    if (Array.isArray(x)) return x.map(recorrer);
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) x[k] = recorrer(x[k]);
      return x;
    }
    return x;
  };
  for (const nodo of copia.nodes || []) {
    // Los nodos Code y los Set de prompts no llevan marcadores de valor: no se tocan.
    if (nodo.type === TIPO_CODE || (nodo.type === TIPO_SET && leerMarcadoresSet(nodo).length)) continue;
    nodo.parameters = recorrer(nodo.parameters);
    for (const cred of Object.values(nodo.credentials || {})) {
      if (cred && credenciales[cred.name]) cred.id = String(credenciales[cred.name]);
      else if (cred) sinValor.add(`credencial "${cred.name}"`);
    }
  }
  if (copia.settings) copia.settings = recorrer(copia.settings);
  return { workflow: copia, sinValor: [...sinValor] };
}

// --- línea de comandos ---------------------------------------------------------------

export function listarPlantillas(raiz = RAIZ_REPO) {
  const dir = join(raiz, 'workflows', 'plantillas');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ nombre: f, ruta: join(dir, f) }));
}

function principal(argumentos) {
  const verificar = argumentos.includes('--verificar');
  const local = argumentos.includes('--local');
  const plantillas = listarPlantillas();
  if (plantillas.length === 0) {
    console.log('No hay plantillas en workflows/plantillas/: nada que ensamblar.');
    return 0;
  }
  let valores = null;
  if (local) {
    const ruta = join(RAIZ_REPO, 'workflows', '_local', 'valores.json');
    if (!existsSync(ruta)) {
      console.error('Falta workflows/_local/valores.json (copia workflows/herramientas/valores.ejemplo.json y llénalo).');
      return 1;
    }
    valores = JSON.parse(leerTexto(ruta));
  }
  let fallas = 0;
  for (const p of plantillas) {
    let wf;
    try {
      wf = ensamblarWorkflow(JSON.parse(leerTexto(p.ruta)));
    } catch (e) {
      console.error(`${p.nombre}:\n${e.message}`);
      fallas += 1;
      continue;
    }
    const problemas = revisarWorkflow(wf);
    if (problemas.length) {
      console.error(`${p.nombre}:\n${problemas.map((x) => `- ${x}`).join('\n')}`);
      fallas += 1;
      continue;
    }
    const destino = join(RAIZ_REPO, 'workflows', p.nombre);
    if (verificar) {
      if (!existsSync(destino)) {
        console.error(`${p.nombre}: falta workflows/${p.nombre} (corre el ensamblador)`);
        fallas += 1;
      } else if (leerTexto(destino) !== serializar(wf)) {
        const existente = JSON.parse(leerTexto(destino));
        const difs = diferenciasMarcadas(existente);
        console.error(`${p.nombre}: difiere del recálculo`);
        for (const d of difs) console.error(`  - nodo "${d.nodo}": ${d.archivo}`);
        if (difs.length === 0) console.error('  - diferencias fuera de los nodos marcados (la plantilla cambió)');
        fallas += 1;
      } else {
        console.log(`${p.nombre}: sin diferencias`);
      }
    } else if (local) {
      const { workflow, sinValor } = aplicarValoresLocales(wf, valores);
      const dirLocal = join(RAIZ_REPO, 'workflows', '_local');
      const salida = join(dirLocal, p.nombre);
      // Protección: nunca escribir valores reales fuera de workflows/_local/.
      if (!resolve(salida).startsWith(resolve(dirLocal) + sep)) throw new Error('destino fuera de _local');
      mkdirSync(dirLocal, { recursive: true });
      writeFileSync(salida, serializar(workflow));
      console.log(`${relative(RAIZ_REPO, salida)} escrito`);
      if (sinValor.length) console.log(`  sin valor en valores.json: ${sinValor.join(', ')}`);
    } else {
      writeFileSync(destino, serializar(wf));
      console.log(`workflows/${p.nombre} escrito`);
    }
  }
  return fallas ? 1 : 0;
}

const esPrincipal = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (esPrincipal) process.exit(principal(process.argv.slice(2)));
