// texto_html: el mismo texto de la alerta, escapado para Telegram con parse_mode HTML.
const test = require('node:test');
const assert = require('node:assert/strict');

const A = require('../alertas');
const { configCE, leerJSON } = require('./ayudas');

const config = configCE();
const base = leerJSON('contrato/ejemplos/evaluacion_ejemplo.json');

function evaluacionConCritico(id, mensajes, dato) {
  const e = JSON.parse(JSON.stringify(base));
  e.lote = 'demo';
  e.agente = 'Laura Méndez';
  for (const c of e.criterios) {
    if (c.tipo_criterio === 'critico') {
      c.resultado = c.id_criterio === id ? 'detectado' : 'no_detectado';
      c.evidencia = c.id_criterio === id ? { mensajes, dato } : { mensajes: [], dato: 'sin evidencia' };
    }
  }
  return e;
}

/** Tras quitar las entidades válidas no debe quedar ningún <, > ni & (ninguna etiqueta cruda). */
const sinHtmlCrudo = (h) => !/[<>&]/.test(h.replace(/&(amp|lt|gt);/g, ''));

test('escaparHtml: & primero, luego < y >; no toca _ ni *', () => {
  assert.equal(A.escaparHtml('a & b <b>x</b> > y'), 'a &amp; b &lt;b&gt;x&lt;/b&gt; &gt; y');
  assert.equal(A.escaparHtml('&lt;'), '&amp;lt;');
  assert.equal(A.escaparHtml('a_b *c*'), 'a_b *c*');
  assert.equal(A.escaparHtml(null), '');
});

test('calidad: guiones bajos, <b>, & y * intactos en texto y escapados en texto_html', () => {
  const e = evaluacionConCritico('critico.promesa_no_autorizada', [4], 'dijo <b>sí</b> & *seguro* a_b');
  const { envios } = A.prepararAlertasCalidad(e, config);
  assert.equal(envios.length, 1);
  assert.ok(envios[0].texto.includes('critico.promesa_no_autorizada'));
  assert.ok(envios[0].texto.includes('<b>sí</b> & *seguro* a_b'));
  assert.ok(envios[0].texto_html.includes('critico.promesa_no_autorizada'));
  assert.ok(envios[0].texto_html.includes('&lt;b&gt;sí&lt;/b&gt; &amp; *seguro* a_b'));
  assert.ok(sinHtmlCrudo(envios[0].texto_html));
  assert.equal(envios[0].texto_html, A.escaparHtml(envios[0].texto));
});

test('operativa, costo, calibración, resumen y cierre de lote traen texto_html', () => {
  const op = A.armarAlertaOperativa({ workflow: 'ingesta', nodo: 'N <x>', tipo_error: 'fallo_nodo', mensaje_error: 'falló a & b <i>z</i>', conversation_id: 'CONV-0001', lote: 'demo' });
  assert.ok(op.texto.includes('<i>z</i>') && op.texto.includes('&'));
  assert.equal(op.texto_html, A.escaparHtml(op.texto));
  assert.ok(sinHtmlCrudo(op.texto_html));

  const costo = A.armarAlertaCosto({ evaluable: true, disparar: true, valor_observado: 1, umbral: 0.5 }, { ambito: 'lote', lote: 'calibracion_v1' });
  assert.equal(costo.texto_html, A.escaparHtml(costo.texto));

  const cal = A.armarAlertaCalibracion({ nombre_metrica: 'acuerdo', valor_observado: 0.5, umbral: 0.8, lote: 'calibracion_v1' });
  assert.equal(cal.texto_html, A.escaparHtml(cal.texto));

  const errores = [{ conversation_id: 'CONV-0002', agente: 'Ana <b>', id_criterio: 'critico.promesa_no_autorizada', mensajes: [3], evidencia: 'x & <y> *z*' }];
  const resumen = A.armarResumenCalidadLote(errores, 'calibracion_v1');
  assert.ok(resumen.texto.includes('critico.promesa_no_autorizada') && resumen.texto.includes('x & <y> *z*'));
  assert.ok(sinHtmlCrudo(resumen.texto_html));
  const cierre = A.cierreDeLote([{ acumular: errores, costo_usd: 0 }], 'calibracion_v1', config);
  const r = cierre.envios.find((x) => x.modo_envio === 'resumen_lote');
  assert.equal(r.texto_html, resumen.texto_html);

  const ev = A.alertasDeEvaluacion(evaluacionConCritico('critico.abandono', [5], 'a < b'), { evaluable: true, disparar: true, valor_observado: 1, umbral: 0.5 }, config);
  assert.ok(ev.envios.length >= 2);
  for (const x of ev.envios) assert.equal(x.texto_html, A.escaparHtml(x.texto));
});

test('resumen de lote: el límite se mide sobre texto_html y no corta entidades', () => {
  // Con & y < el texto escapado crece (& -> &amp;, < -> &lt;): en plano cabe, escapado no.
  const evidencia = '&<'.repeat(60);
  const errores = Array.from({ length: 20 }, (_, i) => ({ conversation_id: `CONV-${1000 + i}`, agente: 'Ana', id_criterio: 'critico.abandono', mensajes: [5], evidencia }));
  const completo = errores.length;
  const r = A.armarResumenCalidadLote(errores, 'calibracion_v2');
  const planoCompleto = r.texto.length;
  assert.ok(planoCompleto <= A.LIMITE_TELEGRAM);
  assert.ok(r.texto_html.length <= A.LIMITE_TELEGRAM, `texto_html mide ${r.texto_html.length}`);
  assert.match(r.texto_html, /\.\.\. y [0-9]+ más/);
  assert.ok(!/&[a-z]*$/.test(r.texto_html) || /&(amp|lt|gt);$/.test(r.texto_html), 'termina en entidad cortada');
  assert.ok(!/&(?!(amp|lt|gt);)/.test(r.texto_html), 'hay un & que no es entidad completa');
  assert.equal(r.texto_html, A.escaparHtml(r.texto));
  // Control: sin el recorte, el plano de todas las líneas sí cabría pero el escapado no.
  const sinRecorte = errores.map((e) => `- ${e.conversation_id} | Ana | ${e.id_criterio} | mensaje(s) 5 | ${e.evidencia.slice(0, 120)}`).join('\n');
  assert.ok(sinRecorte.length < A.LIMITE_TELEGRAM && A.escaparHtml(sinRecorte).length > A.LIMITE_TELEGRAM, `fixture mal calibrado (${completo})`);
});

test('resumen de lote corto no cambia', () => {
  const r = A.armarResumenCalidadLote([{ conversation_id: 'CONV-0101', agente: 'Ana', id_criterio: 'critico.abandono', mensajes: [5], evidencia: 'a & b' }], 'calibracion_v1');
  assert.ok(!/más \(ver hoja/.test(r.texto));
  assert.ok(r.texto.includes('a & b') && r.texto_html.includes('a &amp; b'));
});
