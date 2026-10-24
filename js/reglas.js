/**
 * JS-3 Reglas deterministas (Workflow 2: Evaluación, paso 4).
 *
 * Evalúa todos los subelementos [JS] de `contrato/rubrica.md` que se pueden decidir ANTES
 * de llamar al LLM, y los errores críticos [JS]:
 *   critico.no_toma_a_tiempo, critico.no_genera_caso, critico.abandono,
 *   critico.palabras_altisonantes.
 *
 * Tres criterios de origen JS dependen de un dato que entrega el LLM y por eso se cierran
 * en JS-6 (reglas_hibridas.js), con los hechos que calcula este archivo:
 *   - identidad.pide_datos e identidad.datos_coinciden: su aplicabilidad depende de
 *     `primer_mensaje_info_cuenta` del LLM (rubrica.md, sección 4).
 *   - diagnostico.numero_preguntas: cuenta preguntas antes del primer mensaje de atención
 *     que identifica el LLM.
 *
 * Reglas generales del contrato que se aplican aquí:
 *  - Las frases se comparan sin acentos y sin distinguir mayúsculas (rubrica.md, 3).
 *    Las filas de `listas` con `es_regex = si` ya vienen escritas sin acentos y en
 *    minúsculas y se aplican sobre el texto normalizado; las demás se buscan como
 *    subcadena del texto normalizado.
 *  - Se busca sobre el texto YA ENMASCARADO (salida de JS-2). Así, cualquier fragmento que
 *    se copie como evidencia no lleva datos personales.
 *  - Umbrales, ventanas y tiempos salen de `config`; listas de `listas`. Nada fijo aquí.
 *  - Cada resultado: id_criterio, tipo_criterio, seccion, origen, clasificacion (la pone
 *    JS-7 desde la definición de la rúbrica), resultado, evidencia {mensajes, dato} y
 *    justificacion (la regla aplicada).
 */

// ---------------------------------------------------------------------------
// Utilidades de texto y listas
// ---------------------------------------------------------------------------

function quitarAcentos(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizarTexto(texto) {
  return quitarAcentos(texto).toLowerCase();
}

function escaparRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');
}

/**
 * Prepara las filas de `listas` agrupadas por `clave_lista`.
 * Respeta `tipo_lista`: las filas `sigla_permitida` no son frases a buscar, solo se usan
 * en la regla de mayúsculas sostenidas.
 */
function compilarListas(listas) {
  const grupos = {};
  for (const fila of listas) {
    if (fila.tipo_lista === 'sigla_permitida') continue;
    const esRegex = String(fila.es_regex).trim() === 'si';
    const entrada = { valor: fila.valor, es_regex: esRegex };
    if (esRegex) {
      try {
        // 'g' para encontrar todas las apariciones (plazos), 'i' por seguridad.
        entrada.regex = new RegExp(fila.valor, 'gi');
      } catch (e) {
        throw new Error(`listas: expresión regular inválida en ${fila.clave_lista}: ${e.message}`);
      }
    } else {
      entrada.frase = normalizarTexto(fila.valor).trim();
    }
    (grupos[fila.clave_lista] = grupos[fila.clave_lista] || []).push(entrada);
  }
  return grupos;
}

/** Todas las coincidencias de una lista en un texto normalizado. */
function buscarEnLista(compiladas, claveLista, textoNorm) {
  const encontradas = [];
  for (const entrada of compiladas[claveLista] || []) {
    if (entrada.es_regex) {
      entrada.regex.lastIndex = 0;
      for (const r of textoNorm.matchAll(entrada.regex)) {
        encontradas.push({ valor: entrada.valor, texto: r[0], grupos: r.slice(1), indice: r.index });
      }
    } else if (entrada.frase) {
      const indice = textoNorm.indexOf(entrada.frase);
      if (indice >= 0) encontradas.push({ valor: entrada.valor, texto: entrada.frase, grupos: [], indice });
    }
  }
  return encontradas.sort((a, b) => a.indice - b.indice);
}

/** ¿El texto normalizado contiene el término como palabra completa? (marca, nombre). */
function contienePalabra(textoNorm, termino) {
  const t = normalizarTexto(termino).trim();
  if (!t) return false;
  return new RegExp(`(?<![a-z0-9])${escaparRegex(t)}(?![a-z0-9])`).test(textoNorm);
}

function primerNombre(nombreCompleto) {
  return String(nombreCompleto || '').trim().split(/\s+/)[0] || '';
}

/** Arma un criterio con los nombres de campo de evaluacion.schema.json. */
function crearCriterio(id, origen, resultado, mensajes, dato, justificacion) {
  const prefijo = id.split('.')[0];
  return {
    id_criterio: id,
    tipo_criterio: prefijo === 'critico' ? 'critico' : prefijo === 'identidad' ? 'identidad' : 'subelemento',
    seccion: prefijo,
    origen,
    clasificacion: null, // JS-7 la completa con la definición de la rúbrica
    resultado,
    evidencia: { mensajes: [...new Set(mensajes)].sort((a, b) => a - b), dato },
    justificacion,
  };
}

const lista = (ns) => ns.map((n) => `[${n}]`).join(', ');

// ---------------------------------------------------------------------------
// Números escritos con palabras (lista `numero_en_palabras`)
// ---------------------------------------------------------------------------

/**
 * Antes de aplicar la regex `plazo_seguimiento`, se convierten a cifra los números
 * escritos con palabras ("dos dias habiles" -> "2 dias habiles"). La tabla palabra -> cifra
 * NO está en el código: viene de la lista `numero_en_palabras` de `listas` (columna
 * `notas` = la cifra) y JS-1 la valida al cargarla (`cargarNumerosEnPalabras` en
 * normalizacion.js). Aquí solo se aplica: `numeros` es { "cuarenta y ocho": 48, ... }.
 * Un número en palabras que no esté en la lista no se reconoce.
 */
function convertirNumerosEnPalabras(textoNorm, numeros) {
  if (!numeros || typeof numeros !== 'object') {
    throw new Error('JS-3: falta contexto.numeros_en_palabras (lo carga y valida JS-1)');
  }
  // De la frase más larga a la más corta: "cuarenta y ocho" antes que "ocho".
  const palabras = Object.keys(numeros).sort((a, b) => b.length - a.length);
  if (palabras.length === 0) return textoNorm;
  const patron = new RegExp(
    `(?<![a-z0-9])(${palabras.map((p) => p.split(' ').map(escaparRegex).join('\\s+')).join('|')})(?![a-z0-9])`,
    'g'
  );
  return textoNorm.replace(patron, (encontrado) => String(numeros[encontrado.replace(/\s+/g, ' ')]));
}

/**
 * Convierte un plazo capturado por la regex `plazo_seguimiento` a horas hábiles
 * (rubrica.md 3.11). Grupos de la regex (ver notas de listas.csv): 1 = extremo menor del
 * rango (opcional), 2 = número o extremo mayor, 3 = unidad, 4 = "habiles" (opcional).
 * Con rango se usa el extremo mayor. Devuelve null si la unidad no se reconoce.
 * Los minutos NO son plazo de seguimiento (rubrica.md 3.11): la regex de la lista no los
 * captura, y si llegaran aquí la unidad no se reconocería (null).
 */
function plazoAHorasHabiles(grupos, horasHabilesPorDia) {
  const menor = grupos[0] !== undefined ? Number(grupos[0]) : null;
  const mayor = Number(grupos[1]);
  const numero = menor !== null && Number.isFinite(menor) ? Math.max(menor, mayor) : mayor;
  if (!Number.isFinite(numero)) return null;
  const unidad = String(grupos[2] || '').toLowerCase();
  if (/^(h|hr|hrs|hora|horas)$/.test(unidad)) return numero; // "N horas" (hábiles o no) = N
  if (/^dias?$/.test(unidad)) return numero * horasHabilesPorDia; // con o sin "hábiles"
  if (/^semanas?$/.test(unidad)) return numero * 5 * horasHabilesPorDia; // 5 días hábiles por semana
  return null;
}

// ---------------------------------------------------------------------------
// Detecciones de forma (mayúsculas y signos)
// ---------------------------------------------------------------------------

/**
 * Busca mayúsculas sostenidas en un texto.
 * Interpretación (SUPUESTO): una palabra "cuenta" si está toda en mayúsculas y tiene al
 * menos `minLongitud` letras. Las palabras en mayúsculas más cortas, los números, los
 * marcadores de JS-2 y las siglas permitidas son neutrales: no cuentan, pero tampoco
 * cortan la racha. Una palabra con minúsculas sí corta la racha.
 * Devuelve el fragmento detectado o null.
 */
function detectarMayusculas(texto, siglas, minPalabras, minLongitud) {
  const limpio = String(texto).replace(/\[(EMAIL|RFC|TELEFONO|NOMBRE)_\d+\]/g, ' ');
  const tokens = limpio
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  const comparables = tokens.map((t) => quitarAcentos(t).toUpperCase());
  const neutral = new Array(tokens.length).fill(false);
  // Siglas permitidas, incluidas las de varias palabras ("PUBLICO EN GENERAL").
  for (const sigla of siglas) {
    const partes = quitarAcentos(sigla).toUpperCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i + partes.length <= tokens.length; i++) {
      if (partes.every((p, k) => comparables[i + k] === p)) {
        for (let k = 0; k < partes.length; k++) neutral[i + k] = true;
      }
    }
  }
  let racha = [];
  for (let i = 0; i < tokens.length; i++) {
    if (neutral[i]) continue;
    const letras = tokens[i].replace(/[^\p{L}]/gu, '');
    if (letras.length === 0) continue; // número u otro símbolo: neutral
    if (letras !== letras.toUpperCase()) {
      racha = []; // tiene minúsculas: corta la racha
      continue;
    }
    if (letras.length >= minLongitud) {
      racha.push(tokens[i]);
      if (racha.length >= minPalabras) return racha.join(' ');
    }
  }
  return null;
}

/**
 * Cuenta oraciones que cierran con ? o ! sin el signo de apertura correspondiente.
 * Un grupo de signos de cierre seguidos ("?!") es un solo cierre. El signo de apertura
 * puede estar a mitad de la oración ("Claro, ¿me compartes tu RFC?"). Se ignoran URLs.
 */
function contarSignosApertura(texto) {
  const limpio = String(texto).replace(/https?:\/\/\S+/g, ' ');
  let abrePregunta = 0;
  let abreExclamacion = 0;
  let cierres = 0;
  let omisiones = 0;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === '¿') abrePregunta++;
    else if (c === '¡') abreExclamacion++;
    else if (c === '?' || c === '!') {
      let grupo = '';
      while (i < limpio.length && (limpio[i] === '?' || limpio[i] === '!')) grupo += limpio[i++];
      i--;
      cierres++;
      const ok = (grupo.includes('?') && abrePregunta > 0) || (grupo.includes('!') && abreExclamacion > 0);
      if (!ok) omisiones++;
      abrePregunta = 0;
      abreExclamacion = 0;
    } else if (c === '\n') {
      abrePregunta = 0;
      abreExclamacion = 0;
    }
  }
  return { cierres, omisiones };
}

// ---------------------------------------------------------------------------
// Episodios de espera (glosario.md, sección 7)
// ---------------------------------------------------------------------------

/**
 * Un episodio inicia en un mensaje del agente que coincide con `pide_espera` y termina en
 * el primer mensaje posterior del agente que no coincide con `continua_espera` ni con
 * `pide_espera`. Si no existe, queda ABIERTO y termina en el último mensaje.
 */
function detectarEpisodios(msgs) {
  const episodios = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m.emisor === 'agente' && m.tiene('pide_espera')) {
      let fin = -1;
      for (let j = i + 1; j < msgs.length; j++) {
        const s = msgs[j];
        if (s.emisor === 'agente' && !s.tiene('pide_espera') && !s.tiene('continua_espera')) {
          fin = j;
          break;
        }
      }
      const abierto = fin === -1;
      const finIdx = abierto ? msgs.length - 1 : fin;
      episodios.push({
        inicio_idx: i,
        fin_idx: finIdx,
        inicio_n: m.n,
        fin_n: msgs[finIdx].n,
        abierto,
        duracion_seg: msgs[finIdx].segundos - m.segundos,
      });
      i = abierto ? msgs.length : fin + 1;
    } else {
      i++;
    }
  }
  return episodios;
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/**
 * Evalúa las reglas [JS]. Recibe el contexto con `conversacion` (JS-1) y `extraccion`
 * (JS-2). Devuelve { criterios, variables }. `variables` son hechos que necesita JS-6.
 */
function evaluarReglasJS(contexto) {
  const { config, payload, catalogo, conversacion, extraccion } = contexto;
  const compiladas = compilarListas(contexto.listas);
  const siglas = contexto.listas.filter((f) => f.tipo_lista === 'sigla_permitida').map((f) => f.valor);
  const meta = payload.metadatos_caso;

  // Mensajes con texto enmascarado y normalizado, y sus coincidencias con cada lista.
  const enmascarado = new Map(extraccion.mensajes_enmascarados.map((m) => [m.n, m.texto]));
  const msgs = conversacion.mensajes.map((m) => {
    const texto = enmascarado.has(m.n) ? enmascarado.get(m.n) : m.texto;
    const norm = normalizarTexto(texto);
    const coincidencias = {};
    for (const clave of Object.keys(compiladas)) {
      const encontradas = buscarEnLista(compiladas, clave, norm);
      if (encontradas.length) coincidencias[clave] = encontradas;
    }
    return {
      ...m,
      texto_enmascarado: texto,
      norm,
      coincidencias,
      tiene(clave) {
        return Boolean(coincidencias[clave]);
      },
      primera(clave) {
        return coincidencias[clave] ? coincidencias[clave][0] : null;
      },
    };
  });
  const porN = new Map(msgs.map((m) => [m.n, m]));
  const agente = msgs.filter((m) => m.emisor === 'agente');
  const cliente = msgs.filter((m) => m.emisor === 'cliente');
  const sinAgente = agente.length === 0;
  const pilaAgente = primerNombre(payload.agente);
  const criterios = [];
  const agregar = (...args) => criterios.push(crearCriterio(...args));
  const SIN_AGENTE = 'sin mensajes del agente';

  /** Regla genérica: algún mensaje de la ventana coincide con la lista. */
  function reglaLista(id, ventana, claveLista, justificacion) {
    if (ventana.length === 0) return agregar(id, 'JS', 'no_cumple', [], SIN_AGENTE, justificacion);
    const m = ventana.find((x) => x.tiene(claveLista));
    if (m) return agregar(id, 'JS', 'cumple', [m.n], `frase detectada: "${m.primera(claveLista).texto}"`, justificacion);
    return agregar(id, 'JS', 'no_cumple', ventana.map((x) => x.n), `sin coincidencia con la lista ${claveLista} en ${lista(ventana.map((x) => x.n))}`, justificacion);
  }

  /** Regla genérica: algún mensaje de la ventana contiene el término (marca o nombre). */
  function reglaTermino(id, ventana, termino, descripcion, justificacion) {
    if (ventana.length === 0) return agregar(id, 'JS', 'no_cumple', [], SIN_AGENTE, justificacion);
    const m = ventana.find((x) => contienePalabra(x.norm, termino));
    if (m) return agregar(id, 'JS', 'cumple', [m.n], `${descripcion} detectado: "${normalizarTexto(termino)}"`, justificacion);
    return agregar(id, 'JS', 'no_cumple', ventana.map((x) => x.n), `${descripcion} ausente en ${lista(ventana.map((x) => x.n))}`, justificacion);
  }

  /** Regla genérica de "algo indebido": ningún mensaje del agente coincide con la lista. */
  function reglaProhibida(id, claveLista, justificacion) {
    if (sinAgente) return agregar(id, 'JS', 'no_aplica', [], SIN_AGENTE, justificacion);
    const con = agente.filter((x) => x.tiene(claveLista));
    if (con.length === 0) return agregar(id, 'JS', 'cumple', [], `ningún mensaje del agente coincide con ${claveLista}`, justificacion);
    const terminos = [...new Set(con.map((x) => x.primera(claveLista).texto))];
    return agregar(id, 'JS', 'no_cumple', con.map((x) => x.n), `detectado: ${terminos.map((t) => `"${t}"`).join(', ')}`, justificacion);
  }

  const ventanaApertura = conversacion.primeros_agente_apertura.map((n) => porN.get(n));
  const ventanaPrivacidad = conversacion.primeros_agente_privacidad.map((n) => porN.get(n));
  const ventanaCierre = conversacion.ultimos_agente_cierre.map((n) => porN.get(n));

  // Hechos de identidad que también usa el aviso de privacidad.
  const solicitud = agente.find((x) => x.tiene('pide_datos_identidad')) || null;

  // ===================== 3.1 Apertura =====================
  reglaLista('apertura.saludo', agente.slice(0, 1), 'saludo', 'El primer mensaje del agente debe coincidir con la lista saludo.');
  reglaLista('apertura.bienvenida', ventanaApertura, 'bienvenida', `Los primeros ${config.apertura_mensajes_agente} mensajes del agente deben coincidir con la lista bienvenida.`);
  reglaTermino('apertura.marca', ventanaApertura, config.marca, 'marca', `Los primeros ${config.apertura_mensajes_agente} mensajes del agente deben mencionar la marca (config.marca).`);
  reglaTermino('apertura.nombre_agente', ventanaApertura, pilaAgente, 'nombre del agente', `Los primeros ${config.apertura_mensajes_agente} mensajes del agente deben contener su nombre de pila.`);
  reglaLista('apertura.ofrece_ayuda', ventanaApertura, 'ofrece_ayuda', `Los primeros ${config.apertura_mensajes_agente} mensajes del agente deben ofrecer ayuda o confirmar la solicitud (lista ofrece_ayuda).`);

  // Aviso de privacidad: antes de pedir datos de identidad (se acepta en el mismo mensaje
  // de la solicitud, SUPUESTO) o, si no los pide, en los primeros N mensajes del agente.
  {
    const ventana = solicitud ? agente.filter((x) => x.n <= solicitud.n) : ventanaPrivacidad;
    const justif = solicitud
      ? `El aviso de privacidad debe darse antes de pedir datos de identidad (solicitud en [${solicitud.n}]).`
      : `Sin solicitud de datos: el aviso debe estar en los primeros ${config.apertura_privacidad_mensajes_agente} mensajes del agente.`;
    reglaLista('apertura.aviso_privacidad', ventana, 'aviso_privacidad', justif);
  }

  // Nombre del cliente: pide el nombre o usa el nombre de pila del titular (detectado por JS-2).
  {
    const id = 'apertura.nombre_cliente';
    const justif = `En los primeros ${config.apertura_privacidad_mensajes_agente} mensajes del agente debe pedir el nombre del cliente o usar el nombre del titular.`;
    if (ventanaPrivacidad.length === 0) {
      agregar(id, 'JS', 'no_cumple', [], SIN_AGENTE, justif);
    } else {
      const ns = ventanaPrivacidad.map((x) => x.n);
      const pide = ventanaPrivacidad.find((x) => x.tiene('pide_nombre_cliente'));
      const usa = extraccion.detecciones.find((d) => d.tipo === 'titular' && d.emisor === 'agente' && ns.includes(d.n));
      if (pide) agregar(id, 'JS', 'cumple', [pide.n], `frase detectada: "${pide.primera('pide_nombre_cliente').texto}"`, justif);
      else if (usa) agregar(id, 'JS', 'cumple', [usa.n], `usa el nombre del titular ${usa.marcador || ''}`.trim(), justif);
      else agregar(id, 'JS', 'no_cumple', ns, `no pide ni usa el nombre del cliente en ${lista(ns)}`, justif);
    }
  }

  // Toma a tiempo y su crítico.
  {
    const id = 'apertura.toma_a_tiempo';
    const umbral = config.chat_primera_respuesta_seg;
    const justif = `Primera respuesta del agente ≤ ${umbral} s desde el primer mensaje del cliente (config.chat_primera_respuesta_seg).`;
    let resultado;
    let mensajes;
    let dato;
    let justificacion = justif;
    if (sinAgente) {
      resultado = 'no_cumple';
      mensajes = cliente.length ? [cliente[0].n] : [];
      dato = SIN_AGENTE;
      justificacion = 'No hay ningún mensaje del agente.';
    } else if (conversacion.primer_mensaje_es_agente) {
      resultado = 'no_aplica';
      mensajes = [msgs[0].n];
      dato = 'contacto saliente: el primer mensaje es del agente';
    } else {
      const c1 = cliente[0];
      const a1 = agente[0];
      const seg = a1.segundos - c1.segundos;
      resultado = seg <= umbral ? 'cumple' : 'no_cumple';
      mensajes = [c1.n, a1.n];
      dato = `primera respuesta ${seg} s ${seg <= umbral ? '≤' : '>'} ${umbral} s`;
    }
    agregar(id, 'JS', resultado, mensajes, dato, justificacion);
    agregar(
      'critico.no_toma_a_tiempo',
      'JS',
      resultado === 'no_cumple' ? 'detectado' : 'no_detectado',
      resultado === 'no_cumple' ? mensajes : [],
      resultado === 'no_cumple' ? dato : `apertura.toma_a_tiempo = ${resultado}`,
      resultado === 'no_cumple' ? justificacion : 'Se detecta si apertura.toma_a_tiempo = no_cumple.'
    );
  }

  // ===================== 3.2 Empatía: mayúsculas sostenidas =====================
  {
    const id = 'empatia.mayusculas_sostenidas';
    const justif = `Sin ${config.mayusculas_min_palabras_consecutivas} o más palabras seguidas en mayúsculas de al menos ${config.mayusculas_min_longitud_palabra} letras, ignorando siglas permitidas.`;
    if (sinAgente) {
      agregar(id, 'JS', 'no_aplica', [], SIN_AGENTE, justif);
    } else {
      const hallazgos = agente
        .map((x) => ({ n: x.n, frag: detectarMayusculas(x.texto_enmascarado, siglas, config.mayusculas_min_palabras_consecutivas, config.mayusculas_min_longitud_palabra) }))
        .filter((h) => h.frag);
      if (hallazgos.length === 0) agregar(id, 'JS', 'cumple', [], 'sin mayúsculas sostenidas', justif);
      else agregar(id, 'JS', 'no_cumple', hallazgos.map((h) => h.n), `mayúsculas sostenidas: "${hallazgos[0].frag}"`, justif);
    }
  }

  // ===================== 3.4 Solución (reglas JS) =====================
  // Campos obligatorios de la tipificación del agente.
  {
    const id = 'solucion.campos_obligatorios';
    const justif = 'Los campos_obligatorios de la fila del catálogo con tipificacion_valida = tipificacion_agente deben estar presentes en campos_capturados.';
    const tipificacion = String(meta.tipificacion_agente || '').trim();
    const fila = catalogo.find((f) => String(f.tipificacion_valida).trim() === tipificacion);
    const campos = fila ? String(fila.campos_obligatorios || '').split('|').map((c) => c.trim()).filter(Boolean) : [];
    if (!fila) {
      agregar(id, 'JS', 'no_aplica', [], `tipificación "${tipificacion}" no existe en el catálogo`, justif);
    } else if (campos.length === 0) {
      agregar(id, 'JS', 'no_aplica', [], `la tipificación "${tipificacion}" no tiene campos obligatorios`, justif);
    } else {
      const capturados = meta.campos_capturados || {};
      const faltan = campos.filter((c) => capturados[c] !== 'presente');
      if (faltan.length === 0) agregar(id, 'JS', 'cumple', [], `presentes: ${campos.join(', ')}`, justif);
      else agregar(id, 'JS', 'no_cumple', [], `faltan: ${faltan.join(', ')}`, justif);
    }
  }

  // Seguimiento en plazo (rubrica.md 3.4 y 3.11).
  {
    const id = 'solucion.seguimiento_en_plazo';
    const max = config.seguimiento_plazo_max_horas_habiles;
    const justif = `Si el caso no queda cerrado, el último plazo que comunica el agente debe ser ≤ ${max} horas hábiles (config.seguimiento_plazo_max_horas_habiles).`;
    if (meta.estado_caso === 'cerrado' || meta.estado_caso === 'sin_caso') {
      agregar(id, 'JS', 'no_aplica', [], `estado_caso = ${meta.estado_caso}`, justif);
    } else {
      // Todos los plazos con número en mensajes del agente, en orden.
      const plazos = [];
      for (const x of agente) {
        const convertido = convertirNumerosEnPalabras(x.norm, contexto.numeros_en_palabras);
        for (const p of buscarEnLista(compiladas, 'plazo_seguimiento', convertido)) plazos.push({ n: x.n, ...p });
      }
      if (plazos.length === 0) {
        agregar(id, 'JS', 'no_cumple', agente.map((x) => x.n), sinAgente ? SIN_AGENTE : 'el agente no comunica un plazo con número', justif);
      } else {
        // Contrato 3.11: con varios plazos se evalúa el último que comunica el agente.
        const ultimo = plazos[plazos.length - 1];
        const horas = plazoAHorasHabiles(ultimo.grupos, config.horas_habiles_por_dia);
        if (horas === null) {
          agregar(id, 'JS', 'no_cumple', [ultimo.n], `unidad no reconocida en "${ultimo.texto}"`, justif);
        } else {
          const ok = horas <= max;
          agregar(id, 'JS', ok ? 'cumple' : 'no_cumple', [ultimo.n], `último plazo "${ultimo.texto}" = ${horas} h hábiles ${ok ? '≤' : '>'} ${max}`, justif);
        }
      }
    }
  }

  // ===================== 3.5 Comunicación (reglas JS) =====================
  {
    const id = 'comunicacion.signos_apertura';
    const max = config.signos_apertura_max_omisiones;
    const justif = `Preguntas y exclamaciones del agente con ¿ y ¡; falla si las omisiones son más de ${max} (config.signos_apertura_max_omisiones).`;
    if (sinAgente) {
      agregar(id, 'JS', 'no_aplica', [], SIN_AGENTE, justif);
    } else {
      const conteos = agente.map((x) => ({ n: x.n, ...contarSignosApertura(x.texto) }));
      const cierres = conteos.reduce((a, c) => a + c.cierres, 0);
      const omisiones = conteos.reduce((a, c) => a + c.omisiones, 0);
      if (cierres === 0) agregar(id, 'JS', 'no_aplica', [], 'el agente no hace preguntas ni exclamaciones', justif);
      else {
        const con = conteos.filter((c) => c.omisiones > 0).map((c) => c.n);
        agregar(id, 'JS', omisiones > max ? 'no_cumple' : 'cumple', con, `${omisiones} omisiones de ${cierres} preguntas o exclamaciones (máximo ${max})`, justif);
      }
    }
  }
  reglaProhibida('comunicacion.tecnicismos', 'termino_prohibido', 'Ningún mensaje del agente contiene términos de la lista termino_prohibido.');
  reglaProhibida('comunicacion.frases_negativas', 'frase_negativa', 'Ningún mensaje del agente contiene frases de la lista frase_negativa.');
  reglaProhibida('comunicacion.vicios_lenguaje', 'vicio_lenguaje', 'Ningún mensaje del agente contiene vicios de la lista vicio_lenguaje.');

  // Esperas.
  const episodios = detectarEpisodios(msgs);
  const dentroDeEpisodio = (idx) => episodios.some((e) => idx > e.inicio_idx && idx <= e.fin_idx);
  const indiceDe = new Map(msgs.map((m, i) => [m.n, i]));

  // comunicacion.pide_espera: retrasos de respuesta (sin contar la primera respuesta).
  {
    const id = 'comunicacion.pide_espera';
    const umbral = config.chat_umbral_espera_seg;
    const justif = `Toda espera mayor a ${umbral} s debe anunciarse con pide_espera dentro de ese umbral (config.chat_umbral_espera_seg).`;
    const primerAgenteIdx = msgs.findIndex((m) => m.emisor === 'agente');
    const retrasos = [];
    if (primerAgenteIdx >= 0) {
      for (let i = primerAgenteIdx + 1; i < msgs.length; i++) {
        const c = msgs[i];
        // Solo el primer mensaje del cliente sin respuesta de un turno (es el de mayor espera).
        if (c.emisor !== 'cliente' || msgs[i - 1].emisor !== 'agente') continue;
        if (dentroDeEpisodio(i)) continue; // ya lo evalúan retoma_a_tiempo y no_excede_espera
        const siguiente = msgs.slice(i + 1).find((m) => m.emisor === 'agente');
        if (!siguiente) continue; // sin respuesta: lo cubre critico.abandono
        const seg = siguiente.segundos - c.segundos;
        if (seg > umbral) retrasos.push({ c: c.n, a: siguiente.n, seg });
      }
    }
    if (retrasos.length > 0) {
      const r = retrasos[0];
      agregar(id, 'JS', 'no_cumple', retrasos.flatMap((x) => [x.c, x.a]), `retraso sin anunciar: [${r.c}] → [${r.a}] ${r.seg} s > ${umbral} s${retrasos.length > 1 ? ` (+${retrasos.length - 1} más)` : ''}`, justif);
    } else if (episodios.length > 0) {
      agregar(id, 'JS', 'cumple', episodios.map((e) => e.inicio_n), `esperas anunciadas en ${lista(episodios.map((e) => e.inicio_n))}; sin retrasos`, justif);
    } else {
      agregar(id, 'JS', 'no_aplica', [], 'sin episodios de espera ni retrasos de respuesta', justif);
    }
  }

  // comunicacion.agradece_espera, retoma_a_tiempo, no_excede_espera.
  {
    const justifAgradece = 'El mensaje que cierra cada episodio de espera debe coincidir con agradece_espera; un episodio abierto no cumple.';
    const justifRetoma = `Dentro de cada episodio, ningún intervalo entre mensajes del agente supera ${config.chat_retomar_espera_seg} s (config.chat_retomar_espera_seg).`;
    const justifExcede = `Cada episodio de espera dura ≤ ${config.chat_espera_maxima_seg} s (config.chat_espera_maxima_seg).`;
    if (episodios.length === 0) {
      agregar('comunicacion.agradece_espera', 'JS', 'no_aplica', [], 'sin episodios de espera', justifAgradece);
      agregar('comunicacion.retoma_a_tiempo', 'JS', 'no_aplica', [], 'sin episodios de espera', justifRetoma);
      agregar('comunicacion.no_excede_espera', 'JS', 'no_aplica', [], 'sin episodios de espera', justifExcede);
    } else {
      const sinAgradecer = episodios.filter((e) => e.abierto || !msgs[e.fin_idx].tiene('agradece_espera'));
      if (sinAgradecer.length === 0) {
        agregar('comunicacion.agradece_espera', 'JS', 'cumple', episodios.map((e) => e.fin_n), `agradece la espera en ${lista(episodios.map((e) => e.fin_n))}`, justifAgradece);
      } else {
        const e = sinAgradecer[0];
        agregar('comunicacion.agradece_espera', 'JS', 'no_cumple', sinAgradecer.map((x) => (x.abierto ? x.inicio_n : x.fin_n)), e.abierto ? `episodio iniciado en [${e.inicio_n}] nunca se cierra` : `[${e.fin_n}] cierra la espera sin agradecer`, justifAgradece);
      }

      const lentos = [];
      for (const e of episodios) {
        const delAgente = msgs.slice(e.inicio_idx, e.fin_idx + 1).filter((m) => m.emisor === 'agente');
        for (let k = 1; k < delAgente.length; k++) {
          const seg = delAgente[k].segundos - delAgente[k - 1].segundos;
          if (seg > config.chat_retomar_espera_seg) lentos.push({ de: delAgente[k - 1].n, a: delAgente[k].n, seg });
        }
      }
      if (lentos.length === 0) agregar('comunicacion.retoma_a_tiempo', 'JS', 'cumple', episodios.map((e) => e.inicio_n), 'retoma dentro del tiempo en todos los episodios', justifRetoma);
      else agregar('comunicacion.retoma_a_tiempo', 'JS', 'no_cumple', lentos.flatMap((l) => [l.de, l.a]), `[${lentos[0].de}] → [${lentos[0].a}] ${lentos[0].seg} s > ${config.chat_retomar_espera_seg} s`, justifRetoma);

      const largos = episodios.filter((e) => e.duracion_seg > config.chat_espera_maxima_seg);
      if (largos.length === 0) {
        const mayor = Math.max(...episodios.map((e) => e.duracion_seg));
        agregar('comunicacion.no_excede_espera', 'JS', 'cumple', episodios.flatMap((e) => [e.inicio_n, e.fin_n]), `espera máxima ${mayor} s ≤ ${config.chat_espera_maxima_seg} s`, justifExcede);
      } else {
        const e = largos[0];
        agregar('comunicacion.no_excede_espera', 'JS', 'no_cumple', largos.flatMap((x) => [x.inicio_n, x.fin_n]), `espera [${e.inicio_n}] → [${e.fin_n}]${e.abierto ? ' (abierta)' : ''} ${e.duracion_seg} s > ${config.chat_espera_maxima_seg} s`, justifExcede);
      }
    }
  }

  // ===================== 3.6 Recapitulación (reglas JS) =====================
  // termina_por_inactividad (rubrica.md 3.10): recordatorio, después cierre por inactividad,
  // sin mensajes del cliente entre ambos.
  let terminaPorInactividad = false;
  for (let i = 0; i < msgs.length && !terminaPorInactividad; i++) {
    if (msgs[i].emisor !== 'agente' || !msgs[i].tiene('recordatorio_inactividad')) continue;
    for (let j = i + 1; j < msgs.length; j++) {
      if (msgs[j].emisor === 'cliente') break;
      if (msgs[j].tiene('cierre_inactividad')) {
        terminaPorInactividad = true;
        break;
      }
    }
  }

  // Número de caso.
  const casosAgente = extraccion.numeros_caso.filter((c) => c.emisor === 'agente');
  {
    const id = 'recapitulacion.informa_numero_caso';
    const justif = 'Algún mensaje del agente contiene un número de caso con patrón CASO-nnnnn.';
    if (meta.numero_caso === null) agregar(id, 'JS', 'no_aplica', [], 'numero_caso = null (lo cubre critico.no_genera_caso)', justif);
    else if (casosAgente.length > 0) agregar(id, 'JS', 'cumple', [casosAgente[0].n], `número de caso comunicado: ${casosAgente[0].valor}`, justif);
    else agregar(id, 'JS', 'no_cumple', agente.map((x) => x.n), sinAgente ? SIN_AGENTE : 'el agente no comunica número de caso', justif);
  }
  {
    const id = 'recapitulacion.numero_caso_coincide';
    const justif = 'Todos los números de caso que comunica el agente son iguales a metadatos_caso.numero_caso.';
    if (meta.numero_caso === null || casosAgente.length === 0) {
      agregar(id, 'JS', 'no_aplica', [], meta.numero_caso === null ? 'numero_caso = null' : 'el agente no comunica número de caso', justif);
    } else {
      const distintos = casosAgente.filter((c) => c.valor !== String(meta.numero_caso).toUpperCase());
      if (distintos.length === 0) agregar(id, 'JS', 'cumple', casosAgente.map((c) => c.n), `${casosAgente[0].valor} = ${meta.numero_caso}`, justif);
      else agregar(id, 'JS', 'no_cumple', distintos.map((c) => c.n), `comunicado ${distintos[0].valor} ≠ registrado ${meta.numero_caso}`, justif);
    }
  }

  // Recordatorio por silencio del cliente.
  {
    const id = 'recapitulacion.recordatorio_inactividad';
    const umbral = config.chat_recordatorio_inactividad_seg;
    const justif = `Cada silencio del cliente mayor a ${umbral} s (config.chat_recordatorio_inactividad_seg) debe atenderse con un recordatorio de inactividad.`;
    const largos = [];
    for (let i = 0; i < msgs.length - 1; i++) {
      const a = msgs[i];
      const s = msgs[i + 1];
      if (a.emisor !== 'agente') continue;
      // Exclusiones de la rúbrica: empieza en despedida, cierre o recordatorio; dentro de espera.
      if (a.tiene('despedida') || a.tiene('cierre_inactividad') || a.tiene('recordatorio_inactividad')) continue;
      if (episodios.some((e) => i >= e.inicio_idx && i + 1 <= e.fin_idx)) continue;
      const seg = s.segundos - a.segundos;
      if (seg > umbral) largos.push({ a: a.n, s: s.n, seg, atendido: s.emisor === 'agente' && s.tiene('recordatorio_inactividad') });
    }
    if (largos.length === 0) agregar(id, 'JS', 'no_aplica', [], `sin silencios del cliente mayores a ${umbral} s`, justif);
    else {
      const fallas = largos.filter((l) => !l.atendido);
      if (fallas.length === 0) agregar(id, 'JS', 'cumple', largos.flatMap((l) => [l.a, l.s]), `silencio [${largos[0].a}] → [${largos[0].s}] ${largos[0].seg} s atendido con recordatorio`, justif);
      else agregar(id, 'JS', 'no_cumple', fallas.flatMap((l) => [l.a, l.s]), `silencio [${fallas[0].a}] → [${fallas[0].s}] ${fallas[0].seg} s sin recordatorio`, justif);
    }
  }

  // Cierre por inactividad.
  {
    const id = 'recapitulacion.cierre_inactividad';
    const umbral = config.chat_cierre_inactividad_seg;
    const justif = `Tras un recordatorio sin respuesta, el agente cierra con cierre_inactividad y no antes de ${umbral} s (config.chat_cierre_inactividad_seg).`;
    const recordatorios = agente.filter((x) => x.tiene('recordatorio_inactividad'));
    const evaluados = [];
    for (const r of recordatorios) {
      const iR = indiceDe.get(r.n);
      const despues = msgs.slice(iR + 1);
      const cierre = despues.find((m) => m.emisor === 'agente' && m.tiene('cierre_inactividad'));
      const respuesta = despues.find((m) => m.emisor === 'cliente');
      if (respuesta && (!cierre || respuesta.n < cierre.n)) continue; // el cliente respondió
      // Si hay otro recordatorio antes del cierre (o del final), se evalúa el último.
      const otro = recordatorios.find((r2) => r2.n > r.n && (!cierre || r2.n < cierre.n));
      if (otro) continue;
      if (!cierre) evaluados.push({ ok: false, ns: [r.n], dato: `recordatorio en [${r.n}] sin cierre por inactividad` });
      else {
        const seg = cierre.segundos - r.segundos;
        evaluados.push({ ok: seg >= umbral, ns: [r.n, cierre.n], dato: `cierre [${cierre.n}] ${seg} s después del recordatorio [${r.n}] (${seg >= umbral ? '≥' : '<'} ${umbral} s)` });
      }
    }
    if (evaluados.length === 0) agregar(id, 'JS', 'no_aplica', [], recordatorios.length ? 'el cliente respondió después del recordatorio' : 'sin recordatorio de inactividad', justif);
    else {
      const falla = evaluados.find((e) => !e.ok);
      agregar(id, 'JS', falla ? 'no_cumple' : 'cumple', evaluados.flatMap((e) => e.ns), (falla || evaluados[0]).dato, justif);
    }
  }

  // ===================== 3.7 Ayuda adicional =====================
  {
    const inact = 'termina por inactividad del cliente';
    const estado = meta.estado_caso;
    const justifAyuda = `En los últimos ${config.cierre_mensajes_agente} mensajes del agente debe ofrecer ayuda adicional (lista ayuda_adicional).`;
    if (terminaPorInactividad) agregar('ayuda_adicional.ofrece_ayuda_adicional', 'JS', 'no_aplica', [], inact, justifAyuda);
    else reglaLista('ayuda_adicional.ofrece_ayuda_adicional', ventanaCierre, 'ayuda_adicional', justifAyuda);

    const justifEncuesta = 'Con caso cerrado, algún mensaje del agente ofrece la encuesta (lista encuesta).';
    if (terminaPorInactividad) agregar('ayuda_adicional.encuesta', 'JS', 'no_aplica', [], inact, justifEncuesta);
    else if (estado !== 'cerrado') agregar('ayuda_adicional.encuesta', 'JS', 'no_aplica', [], `estado_caso = ${estado}`, justifEncuesta);
    else reglaLista('ayuda_adicional.encuesta', agente, 'encuesta', justifEncuesta);

    const justifCanales = 'Algún mensaje del agente informa canales u horarios (lista canales_horarios).';
    if (terminaPorInactividad) agregar('ayuda_adicional.canales_horarios', 'JS', 'no_aplica', [], inact, justifCanales);
    else reglaLista('ayuda_adicional.canales_horarios', agente, 'canales_horarios', justifCanales);

    const justifCampana = 'Si hay campaña vigente (config.campana_vigente_activa), algún mensaje del agente la menciona (lista campana_vigente).';
    if (config.campana_vigente_activa !== true) agregar('ayuda_adicional.campana_vigente', 'JS', 'no_aplica', [], 'config.campana_vigente_activa = no', justifCampana);
    else if (terminaPorInactividad) agregar('ayuda_adicional.campana_vigente', 'JS', 'no_aplica', [], inact, justifCampana);
    else reglaLista('ayuda_adicional.campana_vigente', agente, 'campana_vigente', justifCampana);

    const justifEcc = 'No se ofrece la encuesta si el caso no está cerrado.';
    if (estado === 'cerrado') agregar('ayuda_adicional.encuesta_caso_cerrado', 'JS', 'no_aplica', [], 'estado_caso = cerrado (lo cubre ayuda_adicional.encuesta)', justifEcc);
    else if (terminaPorInactividad) agregar('ayuda_adicional.encuesta_caso_cerrado', 'JS', 'no_aplica', [], inact, justifEcc);
    else {
      const con = agente.filter((x) => x.tiene('encuesta'));
      if (con.length) agregar('ayuda_adicional.encuesta_caso_cerrado', 'JS', 'no_cumple', con.map((x) => x.n), `ofrece encuesta con estado_caso = ${estado}`, justifEcc);
      else agregar('ayuda_adicional.encuesta_caso_cerrado', 'JS', 'cumple', [], `no ofrece encuesta con estado_caso = ${estado}`, justifEcc);
    }
  }

  // ===================== 3.8 Cierre (últimos N mensajes del agente) =====================
  {
    const n = config.cierre_mensajes_agente;
    reglaLista('cierre.agradece', ventanaCierre, 'agradecimiento_cierre', `En los últimos ${n} mensajes del agente: agradecimiento (lista agradecimiento_cierre).`);
    reglaTermino('cierre.nombre_agente', ventanaCierre, pilaAgente, 'nombre del agente', `En los últimos ${n} mensajes del agente: su nombre de pila.`);
    reglaTermino('cierre.marca', ventanaCierre, config.marca, 'marca', `En los últimos ${n} mensajes del agente: la marca (config.marca).`);
    reglaLista('cierre.frase_cortesia', ventanaCierre, 'frase_cortesia', `En los últimos ${n} mensajes del agente: frase de cortesía (lista frase_cortesia).`);
    // Despedida: coincide con despedida o con cierre_inactividad.
    const id = 'cierre.despedida';
    const justif = `En los últimos ${n} mensajes del agente: despedida o cierre por inactividad.`;
    if (ventanaCierre.length === 0) agregar(id, 'JS', 'no_cumple', [], SIN_AGENTE, justif);
    else {
      const m = ventanaCierre.find((x) => x.tiene('despedida') || x.tiene('cierre_inactividad'));
      if (m) agregar(id, 'JS', 'cumple', [m.n], `frase detectada: "${(m.primera('despedida') || m.primera('cierre_inactividad')).texto}"`, justif);
      else agregar(id, 'JS', 'no_cumple', ventanaCierre.map((x) => x.n), `sin despedida ni cierre por inactividad en ${lista(ventanaCierre.map((x) => x.n))}`, justif);
    }
  }

  // ===================== 5. Críticos [JS] restantes =====================
  agregar(
    'critico.no_genera_caso',
    'JS',
    meta.numero_caso === null ? 'detectado' : 'no_detectado',
    [],
    `numero_caso: ${meta.numero_caso === null ? 'null' : meta.numero_caso}`,
    'Se detecta si metadatos_caso.numero_caso es null.'
  );

  // Abandono: último mensaje del cliente sin respuesta posterior del agente, salvo que el
  // agente ya se hubiera despedido o cerrado por inactividad antes de ese mensaje.
  {
    const id = 'critico.abandono';
    const u = cliente.length ? cliente[cliente.length - 1] : null;
    if (!u) {
      agregar(id, 'JS', 'no_detectado', [], 'sin mensajes del cliente', 'Se detecta si el último mensaje del cliente no tiene respuesta del agente.');
    } else {
      const iU = indiceDe.get(u.n);
      const respondido = msgs.slice(iU + 1).some((m) => m.emisor === 'agente');
      const despedidaPrevia = msgs.slice(0, iU).find((m) => m.emisor === 'agente' && (m.tiene('despedida') || m.tiene('cierre_inactividad')));
      if (!respondido && !despedidaPrevia) {
        agregar(id, 'JS', 'detectado', [u.n], 'último mensaje del cliente sin respuesta',
          sinAgente ? 'No hay respuesta del agente.' : `No hay respuesta del agente después de [${u.n}] (${u.hora}) ni despedida o cierre previos.`);
      } else {
        agregar(id, 'JS', 'no_detectado', respondido ? [] : [u.n, despedidaPrevia.n],
          respondido ? 'el último mensaje del cliente tiene respuesta' : `el agente ya se había despedido o cerrado en [${despedidaPrevia.n}]`,
          'Se detecta si el último mensaje del cliente no tiene respuesta del agente (excepción: despedida o cierre previos).');
      }
    }
  }

  {
    const id = 'critico.palabras_altisonantes';
    const justif = 'Se detecta si algún mensaje del agente contiene un término de la lista palabra_altisonante.';
    const con = agente.filter((x) => x.tiene('palabra_altisonante'));
    if (con.length) agregar(id, 'JS', 'detectado', con.map((x) => x.n), `término detectado: "${con[0].primera('palabra_altisonante').texto}"`, justif);
    else agregar(id, 'JS', 'no_detectado', [], sinAgente ? SIN_AGENTE : 'sin términos altisonantes', justif);
  }

  // Último mensaje del agente "sobre el tema": se saltan despedidas y cierres/recordatorios
  // de inactividad, que no dicen si el agente seguía pidiendo datos de identidad.
  function ultimoMensajeDeTema(msgsAgente) {
    const ajenos = ['despedida', 'cierre_inactividad', 'recordatorio_inactividad'];
    const tema = msgsAgente.filter((x) => !ajenos.some((c) => x.tiene(c)));
    const ultimo = tema.length ? tema[tema.length - 1] : null;
    return {
      ultimo_mensaje_tema_n: ultimo ? ultimo.n : null,
      // Pedir el número de caso (lista pide_numero_caso) también cuenta como seguir pidiendo, pero NO
      // es solicitud de identidad (no entra en `solicitud`, ni en identidad.pide_datos).
      sigue_pidiendo_datos: ultimo ? ultimo.tiene('pide_datos_identidad') || ultimo.tiene('pide_numero_caso') : false,
    };
  }

  // Hechos para JS-6.
  const variables = {
    sin_mensajes_agente: sinAgente,
    termina_por_inactividad: terminaPorInactividad,
    mensaje_solicitud_n: solicitud ? solicitud.n : null,
    frase_solicitud: solicitud ? solicitud.primera('pide_datos_identidad').texto : null,
    // "Sigue pidiendo datos" (rubrica.md sección 4): aquí solo se informa si el último mensaje del
    // agente que no es despedida, cierre_inactividad ni recordatorio_inactividad coincide con
    // pide_datos_identidad o pide_numero_caso. La condición "posterior al último mensaje del cliente con datos de
    // identidad" se aplica en reglas_hibridas.js (calcularIdentidad), donde están las detecciones.
    ...ultimoMensajeDeTema(agente),
    mensajes_declina: agente.filter((x) => x.tiene('declina_validacion')).map((x) => x.n),
    mensajes_agente_con_pregunta: agente.filter((x) => x.texto.includes('?')).map((x) => x.n),
    mensajes_palabra_solucion: agente.filter((x) => x.tiene('palabra_solucion')).map((x) => x.n),
    mensajes_palabra_seguimiento: agente.filter((x) => x.tiene('palabra_seguimiento')).map((x) => x.n),
    episodios_espera: episodios.map((e) => ({ inicio_n: e.inicio_n, fin_n: e.fin_n, abierto: e.abierto, duracion_seg: e.duracion_seg })),
  };

  return { criterios, variables };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizarTexto,
    compilarListas,
    buscarEnLista,
    convertirNumerosEnPalabras,
    plazoAHorasHabiles,
    detectarMayusculas,
    contarSignosApertura,
    detectarEpisodios,
    crearCriterio,
    evaluarReglasJS,
  };
}

/* ---------------------------------------------------------------------------
 * BLOQUE PARA n8n (nodo Code "JS-3 Reglas deterministas", modo "Run Once for Each Item")
 * Pega TODO este archivo y, debajo, este bloque sin comentar.
 *
 * const contexto = $json;                       // salida de JS-2 (trae numeros_en_palabras, validada por JS-1)
 * contexto.resultados_js = evaluarReglasJS(contexto);
 * // Si contexto.resultados_js.variables.sin_mensajes_agente es true, el workflow NO llama
 * // al LLM y pasa directo a JS-6 con contexto.llm = null (rubrica.md 3.12).
 * // JS-4 debe indicar al LLM el valor de variables.termina_por_inactividad.
 * return { json: contexto };
 * ------------------------------------------------------------------------- */
