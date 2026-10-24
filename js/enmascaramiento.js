/**
 * JS-2 Extracción y enmascaramiento (Workflow 2: Evaluación, paso 3).
 *
 * Qué hace, mensaje por mensaje (glosario.md, sección 6):
 *  1. Detecta datos personales COMPLETOS: correo, RFC, teléfono (10 dígitos con espacios,
 *     guiones o paréntesis) y el nombre del titular de la cuenta (completo, nombre de
 *     pila + apellido, o nombre de pila solo).
 *  2. Los compara contra la hoja `cuentas` (coincide o no con el dato registrado).
 *  3. Detecta datos ENMASCARADOS PARCIALMENTE por el agente (por ejemplo
 *     `j***@dominio.example`, `******5678`) y revisa si corresponden a la cuenta y si
 *     respetan el formato permitido de `config` (lo usa `critico.confidencialidad`).
 *  4. Extrae los números de caso (`CASO-nnnnn`); no se enmascaran porque no son datos
 *     personales.
 *  5. Reemplaza cada dato completo por un marcador `[EMAIL_n]`, `[RFC_n]`,
 *     `[TELEFONO_n]` o `[NOMBRE_n]`. El mismo valor recibe siempre el mismo marcador y
 *     los números se asignan en orden de aparición.
 *
 * Excepciones del contrato:
 *  - Los canales oficiales (`config.canales_oficiales_correos` y
 *    `config.canales_oficiales_telefonos`) no son datos personales: no se enmascaran.
 *  - Los RFC genéricos del SAT (`config.rfc_genericos_permitidos`: público en general y
 *    extranjeros) tampoco son datos personales: no se enmascaran, no cuentan como dato de
 *    identidad y no activan `critico.confidencialidad`. Se marcan igual que los canales
 *    oficiales (`es_oficial = true`). Un RFC que NO es el de la cuenta ni genérico (por
 *    ejemplo el RFC del receptor de una factura) sí se enmascara como [RFC_n]; si lo
 *    escribe el cliente cuenta como dato incorrecto (solo evidencia), si lo revela el
 *    agente cuenta como dato de un tercero.
 *  - El nombre de pila del titular no se enmascara dentro de un mensaje del agente cuando
 *    es igual al nombre de pila del agente (para no ocultar su presentación).
 *
 * Por qué: el LLM nunca debe ver datos personales; solo recibe `mensajes_enmascarados`.
 * Las detecciones con el valor real se quedan dentro del Workflow 2 (JS-6 las necesita
 * para la validación de identidad y la confidencialidad) y nunca se escriben en Sheets.
 *
 * Los patrones de formato (correo, RFC, teléfono, número de caso) son los formatos
 * fijados en `glosario.md` sección 2, no umbrales: por eso viven aquí y no en `config`.
 */

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

/** Quita acentos y diéresis (é → e, ñ → n, ü → u). */
function quitarAcentos(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Texto comparable: sin acentos y en minúsculas (convención de rubrica.md 3). */
function normalizarTexto(texto) {
  return quitarAcentos(texto).toLowerCase();
}

/**
 * Normaliza el texto y guarda, para cada carácter normalizado, su posición en el texto
 * original. Así podemos buscar el nombre sin acentos y reemplazarlo en el original.
 */
function normalizarConMapa(texto) {
  let norm = '';
  const mapa = [];
  for (let i = 0; i < texto.length; i++) {
    const pieza = normalizarTexto(texto[i]);
    for (const c of pieza) {
      norm += c;
      mapa.push(i);
    }
  }
  return { norm, mapa };
}

function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');
}

function soloDigitos(texto) {
  return String(texto).replace(/\D/g, '');
}

function seTraslapa(span, ocupados) {
  return ocupados.some((o) => span.inicio < o.fin && o.inicio < span.fin);
}

// ---------------------------------------------------------------------------
// Patrones
// ---------------------------------------------------------------------------

/**
 * Expresiones regulares. `X` es el carácter de enmascarado de `config`
 * (`enmascarado_caracter`, por defecto `*`). Los "límites" (?<! ...) y (?! ...) evitan
 * tomar pedazos de una palabra más larga; por ejemplo, que el final `ta@x.example` de
 * `ju**ta@x.example` se lea como un correo completo.
 */
function construirPatrones(caracter) {
  const X = escaparRegex(caracter);
  const local = `A-Za-z0-9._%+\\-`;
  const dominio = `[A-Za-z0-9\\-]+(?:\\.[A-Za-z0-9\\-]+)*\\.[A-Za-z]{2,}`;
  return {
    correoParcial: new RegExp(`(?<![${local}${X}])[${local}${X}]*${X}[${local}${X}]*@${dominio}`, 'g'),
    correo: new RegExp(`(?<![${local}${X}])[${local}]+@${dominio}`, 'g'),
    // RFC parcial: 12 o 13 posiciones de [A-ZÑ&0-9*] con al menos un * (rubrica.md, sección 5).
    rfcParcial: new RegExp(`(?<![A-Za-zÑñ&0-9${X}@.])[A-Za-zÑñ&0-9${X}]{12,13}(?![A-Za-zÑñ&0-9${X}@])`, 'g'),
    // RFC completo, sin distinguir mayúsculas (glosario.md, sección 6).
    rfc: new RegExp(`(?<![A-Za-zÑñ&0-9${X}])[A-Za-zÑñ&]{3,4}[0-9]{6}[A-Za-z0-9]{3}(?![A-Za-zÑñ&0-9${X}])`, 'g'),
    // Teléfono parcial: 10 posiciones de dígitos o *, con espacios o guiones opcionales.
    telefonoParcial: new RegExp(`(?<![A-Za-z0-9${X}])[0-9${X}](?:[ \\-]?[0-9${X}]){9}(?![A-Za-z0-9${X}])`, 'g'),
    // Teléfono completo: 10 dígitos admitiendo espacios, guiones o paréntesis.
    telefono: new RegExp(`(?<![A-Za-z0-9${X}])\\(?[0-9](?:[ \\-()]{0,2}[0-9]){9}(?![A-Za-z0-9${X}])`, 'g'),
    // Número de caso (glosario.md, sección 2).
    numeroCaso: /(?<![A-Za-z0-9])CASO-[0-9]{5}(?![0-9])/gi,
  };
}

/**
 * Formas del nombre del titular que se enmascaran, de la más larga a la más corta para
 * que "Héctor Villanueva Ruiz" se reemplace completo y no por partes.
 * Supuesto: el nombre de pila es la primera palabra de `cuentas.titular` y los apellidos
 * son las demás.
 */
function formasTitular(titular) {
  const tokens = normalizarTexto(titular).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const pila = tokens[0];
  const formas = [];
  if (tokens.length > 1) {
    formas.push({ forma: 'completo', tokens });
    for (const apellido of tokens.slice(1)) {
      if (tokens.length > 2) formas.push({ forma: 'pila_apellido', tokens: [pila, apellido] });
    }
  }
  formas.push({ forma: 'pila', tokens: [pila] });
  return formas.map((f) => ({
    ...f,
    regex: new RegExp(`(?<![a-z0-9])${f.tokens.map(escaparRegex).join('\\s+')}(?![a-z0-9])`, 'g'),
  }));
}

// ---------------------------------------------------------------------------
// Datos parciales (enmascarados por el agente)
// ---------------------------------------------------------------------------

/**
 * Revisa un correo parcial: si corresponde a la cuenta (mismo dominio y cada carácter
 * visible igual al registrado en la misma posición) y si respeta el formato permitido
 * (solo los primeros N caracteres de la parte local visibles, N de config).
 */
function analizarCorreoParcial(texto, cuenta, config) {
  const X = config.enmascarado_caracter;
  const arroba = texto.lastIndexOf('@');
  const local = texto.slice(0, arroba);
  const dominio = texto.slice(arroba + 1).toLowerCase();
  const real = String(cuenta.correo || '').toLowerCase();
  const realLocal = real.slice(0, real.lastIndexOf('@'));
  const realDominio = real.slice(real.lastIndexOf('@') + 1);
  const visiblesIdx = [];
  let corresponde = dominio === realDominio;
  for (let i = 0; i < local.length; i++) {
    if (local[i] === X) continue;
    visiblesIdx.push(i);
    if (realLocal[i] !== local[i].toLowerCase()) corresponde = false;
  }
  const alInicio = visiblesIdx.every((idx, k) => idx === k);
  return {
    corresponde_cuenta: corresponde,
    visibles: visiblesIdx.length,
    formato_permitido: alInicio && visiblesIdx.length <= config.enmascarado_correo_visibles_inicio,
  };
}

/**
 * Revisa un teléfono o RFC parcial: posiciones sin separadores, comparadas una a una con
 * el dato registrado. Formato permitido: solo los últimos N caracteres visibles.
 */
function analizarParcialAlFinal(texto, real, maxVisibles, X) {
  const posiciones = texto.replace(/[ \-]/g, '').toUpperCase();
  const realNorm = String(real || '').toUpperCase();
  const visiblesIdx = [];
  let corresponde = posiciones.length === realNorm.length;
  for (let i = 0; i < posiciones.length; i++) {
    if (posiciones[i] === X) continue;
    visiblesIdx.push(i);
    if (realNorm[i] !== posiciones[i]) corresponde = false;
  }
  const k = visiblesIdx.length;
  const alFinal = visiblesIdx.every((idx, j) => idx === posiciones.length - k + j);
  return { corresponde_cuenta: corresponde, visibles: k, formato_permitido: alFinal && k <= maxVisibles };
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

const PREFIJO_MARCADOR = { correo: 'EMAIL', rfc: 'RFC', telefono: 'TELEFONO', titular: 'NOMBRE' };

/**
 * Extrae y enmascara. Recibe el `contexto` de JS-1 y devuelve `extraccion`:
 *  - mensajes_enmascarados: [{n, emisor, timestamp, texto}] → lo único que ve el LLM.
 *  - detecciones: datos completos [{n, emisor, tipo, forma, valor_normalizado, marcador,
 *    es_oficial, coincide_cuenta}] (uso interno; contiene valores reales).
 *  - parciales: datos parciales del agente [{n, tipo, marcador_descriptivo,
 *    corresponde_cuenta, visibles, formato_permitido}].
 *  - numeros_caso: [{n, emisor, valor}].
 */
function extraerYEnmascarar(contexto) {
  const { conversacion, cuenta, config, payload } = contexto;
  const X = config.enmascarado_caracter;
  const pat = construirPatrones(X);
  const oficialesCorreo = (config.canales_oficiales_correos || []).map((c) => c.toLowerCase());
  const oficialesTelefono = (config.canales_oficiales_telefonos || []).map(soloDigitos);
  const rfcGenericos = (config.rfc_genericos_permitidos || []).map((r) => r.toUpperCase());
  const pilaAgente = normalizarTexto(payload.agente).trim().split(/\s+/)[0];
  const formas = formasTitular(cuenta.titular);
  const correoCuenta = String(cuenta.correo || '').toLowerCase();
  const rfcCuenta = String(cuenta.rfc || '').toUpperCase();
  const telefonoCuenta = soloDigitos(cuenta.telefono || '');

  // Lista `dato_de_tercero` (listas, contractual): frases o regex que, dentro de la misma cláusula que un
  // dato, indican que es de un tercero ("RFC del receptor", "de mi cliente"). REGLA DEL DUEÑO: un dato que
  // coincide con el de la cuenta NUNCA es de tercero; la lista solo aplica a datos que no coinciden.
  const frasesTercero = (contexto.listas || [])
    .filter((f) => f.clave_lista === 'dato_de_tercero')
    .map((f) => (String(f.es_regex).trim() === 'si' ? new RegExp(f.valor, 'i') : normalizarTexto(f.valor).trim()));
  /** ¿La cláusula (hasta . ? ! ; o salto de línea) donde está el dato menciona a un tercero? */
  const esDeTercero = (texto, span, emisor, coincideCuenta) => {
    if (emisor !== 'cliente' || coincideCuenta || !frasesTercero.length) return false;
    const antes = Math.max(...['\n', '.', '?', '!', ';'].map((c) => texto.lastIndexOf(c, Math.max(span.inicio - 1, 0))));
    const sig = /[.?!;\n]/.exec(texto.slice(span.fin));
    const clausula = normalizarTexto(texto.slice(antes + 1, sig ? span.fin + sig.index : texto.length));
    return frasesTercero.some((f) => (typeof f === 'string' ? clausula.includes(f) : f.test(clausula)));
  };

  const contadores = { correo: 0, rfc: 0, telefono: 0, titular: 0 };
  const marcadorPorValor = new Map();
  const detecciones = [];
  const parciales = [];
  const numerosCaso = [];
  const mensajesEnmascarados = [];

  for (const m of conversacion.mensajes) {
    const texto = String(m.texto);
    const ocupados = [];
    const spans = [];

    // 1) Parciales (solo importan en mensajes del agente: confidencialidad).
    if (m.emisor === 'agente') {
      for (const r of texto.matchAll(pat.correoParcial)) {
        const span = { inicio: r.index, fin: r.index + r[0].length };
        ocupados.push(span);
        parciales.push({ n: m.n, tipo: 'correo', ...analizarCorreoParcial(r[0], cuenta, config) });
      }
      for (const r of texto.matchAll(pat.rfcParcial)) {
        const span = { inicio: r.index, fin: r.index + r[0].length };
        // Debe tener al menos un * y al menos un carácter visible (si no, no revela nada).
        if (!r[0].includes(X) || r[0].split('').every((c) => c === X) || seTraslapa(span, ocupados)) continue;
        ocupados.push(span);
        parciales.push({ n: m.n, tipo: 'rfc', ...analizarParcialAlFinal(r[0], rfcCuenta, config.enmascarado_rfc_visibles_final, X) });
      }
      for (const r of texto.matchAll(pat.telefonoParcial)) {
        const span = { inicio: r.index, fin: r.index + r[0].length };
        if (!r[0].includes(X) || !/[0-9]/.test(r[0]) || seTraslapa(span, ocupados)) continue;
        ocupados.push(span);
        parciales.push({ n: m.n, tipo: 'telefono', ...analizarParcialAlFinal(r[0], telefonoCuenta, config.enmascarado_telefono_visibles_final, X) });
      }
    }

    // 2) Correos completos (primero, para que un RFC o teléfono dentro de un correo no se lea aparte).
    for (const r of texto.matchAll(pat.correo)) {
      const span = { inicio: r.index, fin: r.index + r[0].length };
      if (seTraslapa(span, ocupados)) continue;
      ocupados.push(span);
      const valor = r[0].toLowerCase();
      spans.push({ ...span, tipo: 'correo', forma: null, valor, es_oficial: oficialesCorreo.includes(valor), coincide_cuenta: valor === correoCuenta, de_tercero: esDeTercero(texto, span, m.emisor, valor === correoCuenta) });
    }
    // 3) RFC completos (se comparan en mayúsculas).
    for (const r of texto.matchAll(pat.rfc)) {
      const span = { inicio: r.index, fin: r.index + r[0].length };
      if (seTraslapa(span, ocupados)) continue;
      ocupados.push(span);
      const valor = r[0].toUpperCase();
      spans.push({ ...span, tipo: 'rfc', forma: null, valor, es_oficial: rfcGenericos.includes(valor), coincide_cuenta: valor === rfcCuenta, de_tercero: esDeTercero(texto, span, m.emisor, valor === rfcCuenta) });
    }
    // 4) Teléfonos completos (se comparan solo dígitos).
    for (const r of texto.matchAll(pat.telefono)) {
      const span = { inicio: r.index, fin: r.index + r[0].length };
      const valor = soloDigitos(r[0]);
      if (valor.length !== 10 || seTraslapa(span, ocupados)) continue;
      ocupados.push(span);
      spans.push({ ...span, tipo: 'telefono', forma: null, valor, es_oficial: oficialesTelefono.includes(valor), coincide_cuenta: valor === telefonoCuenta, de_tercero: esDeTercero(texto, span, m.emisor, valor === telefonoCuenta) });
    }
    // 5) Nombre del titular, sin acentos ni mayúsculas.
    const { norm, mapa } = normalizarConMapa(texto);
    for (const f of formas) {
      // Excepción del glosario: no ocultar la presentación del agente.
      if (f.forma === 'pila' && m.emisor === 'agente' && f.tokens[0] === pilaAgente) continue;
      for (const r of norm.matchAll(f.regex)) {
        const span = { inicio: mapa[r.index], fin: mapa[r.index + r[0].length - 1] + 1 };
        if (seTraslapa(span, ocupados)) continue;
        ocupados.push(span);
        spans.push({ ...span, tipo: 'titular', forma: f.forma, valor: 'titular', es_oficial: false, coincide_cuenta: true, de_tercero: false });
      }
    }
    // 6) Números de caso: se extraen, no se enmascaran.
    for (const r of texto.matchAll(pat.numeroCaso)) {
      numerosCaso.push({ n: m.n, emisor: m.emisor, valor: r[0].toUpperCase() });
    }

    // Marcadores en orden de aparición. Mismo valor → mismo marcador en toda la conversación.
    spans.sort((a, b) => a.inicio - b.inicio);
    for (const s of spans) {
      if (!s.es_oficial) {
        const llave = `${s.tipo}|${s.valor}`;
        if (!marcadorPorValor.has(llave)) {
          contadores[s.tipo] += 1;
          marcadorPorValor.set(llave, `[${PREFIJO_MARCADOR[s.tipo]}_${contadores[s.tipo]}]`);
        }
        s.marcador = marcadorPorValor.get(llave);
      } else {
        s.marcador = null;
      }
      detecciones.push({
        n: m.n,
        emisor: m.emisor,
        tipo: s.tipo,
        forma: s.forma,
        valor_normalizado: s.valor,
        marcador: s.marcador,
        es_oficial: s.es_oficial,
        coincide_cuenta: s.coincide_cuenta,
        de_tercero: s.de_tercero === true,
      });
    }

    // Reemplazo de atrás hacia adelante para no mover las posiciones pendientes.
    let enmascarado = texto;
    for (const s of [...spans].reverse()) {
      if (s.es_oficial) continue;
      enmascarado = enmascarado.slice(0, s.inicio) + s.marcador + enmascarado.slice(s.fin);
    }
    mensajesEnmascarados.push({ n: m.n, emisor: m.emisor, timestamp: m.timestamp, texto: enmascarado });
  }

  return {
    mensajes_enmascarados: mensajesEnmascarados,
    detecciones,
    parciales,
    numeros_caso: numerosCaso,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    quitarAcentos,
    normalizarTexto,
    normalizarConMapa,
    construirPatrones,
    formasTitular,
    analizarCorreoParcial,
    analizarParcialAlFinal,
    extraerYEnmascarar,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "JS-2 Enmascaramiento", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * const contexto = $json;                       // salida de JS-1
 * contexto.extraccion = extraerYEnmascarar(contexto);
 * // JS-4 (construccion_prompt.js) usa solo contexto.extraccion.mensajes_enmascarados.
 * // contexto.extraccion.detecciones contiene valores reales: no escribirla en Sheets ni en logs.
 * return { json: contexto };
 * ------------------------------------------------------------------------- */
