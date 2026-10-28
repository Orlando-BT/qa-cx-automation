// =============================================================================
// ejecutor_n8n.js — ejecuta nodos Code de un workflow generado como lo hace n8n,
// para probar sin n8n que el pegamento y las funciones de js/ encajan.
// -----------------------------------------------------------------------------
// No es n8n: solo imita lo que usa el pegamento: $('Nodo').first()/.all()/.item,
// $input.item/.all()/.first(), $json, $itemIndex y los modos "Run Once for All Items" y
// "Run Once for Each Item" (incluida la regla de n8n que rechaza $input.first/last/all/itemMatching
// en el modo por ítem). También corre los Set en modo JSON y los Split Out. Las salidas de los
// demás nodos (Sheets, HTTP, Telegram) las pone la prueba a mano con `fijar`.
// =============================================================================
'use strict';

const FuncionAsincrona = Object.getPrototypeOf(async function () {}).constructor;

// Copia de validateNoDisallowedMethodsInRunForEach (n8n 2.32.6,
// n8n-nodes-base/dist/nodes/Code/JsCodeValidator.js), que n8n aplica solo en modo por ítem:
//  (a) busca la regex en TODO el código, comentarios incluidos;
//  (b) si coincide, busca la primera línea que (sin espacios iniciales) contenga el nombre del
//      método como subcadena (por ejemplo "all" dentro de "fallo") y no empiece con //, /* ni *;
//  (c) si existe esa línea, rechaza el nodo con "Can't use .<método>() here".
// $('Nodo').all() no coincide con la regex y n8n lo permite.
const RE_METODO_POR_ITEM = /\$input\.(?<metodo>first|last|all|itemMatching)/;

function validarMetodosPorItem(codigo) {
  const match = codigo.match(RE_METODO_POR_ITEM);
  if (!match || !match.groups || !match.groups.metodo) return;
  const { metodo } = match.groups;
  const linea =
    codigo.split('\n').findIndex((l) => {
      const t = l.trimStart();
      return t.includes(metodo) && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
    }) + 1;
  if (linea !== 0) {
    const error = new Error(`Can't use .${metodo}() here`);
    error.description = "This is only available in 'Run Once for All Items' mode";
    error.lineNumber = linea;
    throw error;
  }
}

function crearEjecutor(workflow) {
  const salidas = new Map(); // nombre de nodo -> [{ json }]
  const nodo = (nombre) => {
    const n = workflow.nodes.find((x) => x.name === nombre);
    if (!n) throw new Error(`no existe el nodo "${nombre}" en ${workflow.name}`);
    return n;
  };
  const copia = (x) => JSON.parse(JSON.stringify(x));

  function referencia(indice) {
    return (nombre) => {
      if (!salidas.has(nombre)) throw new Error(`el pegamento lee "${nombre}", que aún no tiene salida`);
      const items = salidas.get(nombre);
      return {
        first: () => copia(items[0]),
        all: () => copia(items),
        get item() {
          return copia(items[Math.min(indice, items.length - 1)]);
        },
      };
    };
  }

  return {
    /** Fija la salida de un nodo que no es Code (lectura de hoja, HTTP, Telegram...). */
    fijar(nombre, jsons) {
      nodo(nombre);
      salidas.set(nombre, jsons.map((json) => ({ json: copia(json) })));
    },
    salida(nombre) {
      return (salidas.get(nombre) || []).map((i) => i.json);
    },
    /** Ejecuta un nodo Code con los ítems de entrada (jsons) y guarda su salida. */
    async correr(nombre, entrada) {
      const n = nodo(nombre);
      if (n.type !== 'n8n-nodes-base.code') throw new Error(`"${nombre}" no es un nodo Code`);
      const codigo = n.parameters.jsCode;
      const itemsEntrada = entrada.map((json) => ({ json: copia(json) }));
      const porItem = n.parameters.mode === 'runOnceForEachItem';
      const f = new FuncionAsincrona('$', '$input', '$json', '$itemIndex', codigo);
      let resultado = [];
      if (porItem) {
        validarMetodosPorItem(codigo);
        for (let i = 0; i < itemsEntrada.length; i++) {
          const item = itemsEntrada[i];
          const $input = { item, all: () => itemsEntrada, first: () => itemsEntrada[0] };
          const r = await f(referencia(i), $input, item.json, i);
          resultado.push(Array.isArray(r) ? r[0] : r);
        }
      } else {
        const $input = { all: () => itemsEntrada, first: () => itemsEntrada[0], item: itemsEntrada[0] };
        const r = await f(referencia(0), $input, itemsEntrada[0] && itemsEntrada[0].json, 0);
        resultado = Array.isArray(r) ? r : [r];
      }
      salidas.set(nombre, resultado.map((x) => ({ json: copia(x.json) })));
      return resultado.map((x) => x.json);
    },
    /**
     * Ejecuta un Set en modo JSON (jsonOutput = una expresión ={{ ... }}): la salida de cada ítem
     * es exactamente el objeto de la expresión. Con executeOnce solo corre el primer ítem.
     */
    correrSetJson(nombre, entrada) {
      const n = nodo(nombre);
      if (n.type !== 'n8n-nodes-base.set' || n.parameters.mode !== 'raw') throw new Error(`"${nombre}" no es un Set en modo JSON`);
      const m = /^=\{\{([\s\S]*)\}\}$/.exec(n.parameters.jsonOutput);
      const f = new Function('$', '$json', `return (${m[1]});`);
      const items = n.executeOnce ? entrada.slice(0, 1) : entrada;
      const resultado = items.map((json, i) => copia(f(referencia(i), copia(json))));
      salidas.set(nombre, resultado.map((json) => ({ json: copia(json) })));
      return resultado;
    },
    /** Split Out con include = noOtherFields: un ítem por elemento del arreglo. */
    separar(nombre, entrada) {
      const n = nodo(nombre);
      if (n.type !== 'n8n-nodes-base.splitOut') throw new Error(`"${nombre}" no es un Split Out`);
      const campo = n.parameters.fieldToSplitOut;
      const destino = n.parameters.options && n.parameters.options.destinationFieldName;
      const resultado = entrada.flatMap((json) => json[campo].map((x) => (x && typeof x === 'object' && !destino ? copia(x) : { [destino || campo]: x })));
      salidas.set(nombre, resultado.map((json) => ({ json: copia(json) })));
      return resultado;
    },
    /** Nodos que llegan a `nombre`: [{ de, salida }]. */
    origenes(nombre) {
      nodo(nombre);
      const lista = [];
      for (const [de, c] of Object.entries(workflow.connections)) {
        (c.main || []).forEach((destinos, salida) => {
          for (const d of destinos || []) if (d.node === nombre) lista.push({ de, salida });
        });
      }
      return lista;
    },
    /** Valor de un nodo Set marcado con RELLENO (lo que n8n entregaría). */
    valorSet(nombre) {
      const json = {};
      for (const a of nodo(nombre).parameters.assignments.assignments) json[a.name] = a.type === 'object' ? JSON.parse(a.value) : a.value;
      return json;
    },
  };
}

module.exports = { crearEjecutor, validarMetodosPorItem, RE_METODO_POR_ITEM };
