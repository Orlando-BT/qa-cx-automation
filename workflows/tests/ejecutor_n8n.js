// =============================================================================
// ejecutor_n8n.js — ejecuta nodos Code de un workflow generado como lo hace n8n,
// para probar sin n8n que el pegamento y las funciones de js/ encajan.
// -----------------------------------------------------------------------------
// No es n8n: solo imita lo que usa el pegamento: $('Nodo').first()/.all()/.item,
// $input.item/.all()/.first(), $json, $itemIndex y los modos "Run Once for All Items" y
// "Run Once for Each Item". Las salidas de los nodos que no son Code (Sheets, HTTP, Set) las
// pone la prueba a mano con `fijar`.
// =============================================================================
'use strict';

const FuncionAsincrona = Object.getPrototypeOf(async function () {}).constructor;

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
    /** Fija la salida de un nodo que no es Code (lectura de hoja, HTTP, Set...). */
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
    /** Valor de un nodo Set marcado con RELLENO (lo que n8n entregaría). */
    valorSet(nombre) {
      const json = {};
      for (const a of nodo(nombre).parameters.assignments.assignments) json[a.name] = a.type === 'object' ? JSON.parse(a.value) : a.value;
      return json;
    },
  };
}

module.exports = { crearEjecutor };
