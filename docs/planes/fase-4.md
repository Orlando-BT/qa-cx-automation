# Plan Fase 4: métricas de v1 y versión 2

Aprobado por el dueño el 11-nov-2026, con las decisiones de la sección "Decisiones del dueño".

## Acción inmediata (lo único que se ejecuta en esta sesión)
1. Guardar este plan completo en `docs/planes/fase-4.md`.
2. Commit solo de ese archivo con la convención (`Subagente: orquestador`) y push, con los checks previos (rama `main`, árbol limpio salvo ese archivo, `.env` no rastreado, lista de commits).
3. Nada más: el dueño reinicia la sesión desde la carpeta del repositorio para que los subagentes se carguen con su nombre.

## Contexto
La Fase 3 cerró (`fase-3-cierre`): la calificación a ciegas de `calibracion_v1` está en Git antes de cualquier evaluación del sistema. Desde ahora se pueden ver resultados y verdad de escenarios. Objetivo: Hito A = métricas reales de v1 (prioridad, para la postulación); Hito B = v2 sin sobreajustar a las mismas 24 y tablero.

Estado verificado (lectura, 11-nov-2026):
- W3 (`workflows/03_metricas.json`) es un esqueleto: lee `revision_humana`, `evaluaciones` y `escenarios`; el nodo de cálculo es un noOp, "Escribir metricas" no está conectado y **no lee `detalle_criterios`**. No hay ningún cálculo de métricas en `js/` y `metricas/` no existe.
- Reutilizable: `js/scoring.js` (`factorDe`, `calcularNotaBase` D5, `calcularCalidad` banda, `criteriosEsperados` para mapear `h_*` a ID y origen), `js/validador_revision_humana.js` (`parsearCSV`, `diferenciaD1`, `tipoDeColumna`), `js/alertas.js` (`armarAlertaCalibracion`), `prompts/verificacion/verificar_openai.mjs` (modo lote fuera de n8n; lógica de `criticos_solo_llm` y de concordancia con escenario).
- El humano calificó solo: 8 secciones, 19 subelementos clave, 3 de identidad y 12 críticos (no hay complementarios ni banda; la nota y la banda humanas se derivan con D2/D5 y la rúbrica 2.4).
- La hoja `escenarios` no tiene `nota_esperada` ni `secciones_esperadas`; están solo en `datos/lotes/calibracion_v1/_escenarios.json`.
- Disparador manual de calibración en W1: viene desactivado y con `lote` vacío (`IMPORTAR.md:385-390`); `planificarCalibracionManual` (`js/ingesta.js:224-280`) crea las filas pendientes y W1 llama a W2 una por una.
- Config: `umbral_acuerdo_global` 0.80, `umbral_diferencia_nota` 5, `precision_criticos_referencia` 0.95, `kappa_solo_informativo` si, `costo_estimado_por_evaluacion_usd` 0.005 y `tope_costo_lote_usd` 0.25 (ambos PROVISIONALES).
- Backlog leído (registro técnico, Fase 1 §4 y §4b, Fase 2 §9 y §14). **No estaban escritos en el registro**: "veto de JS a críticos solo-LLM con RFC genérico" e "intentos incorrectos de identidad como señal" (solo existían "medir críticos solo-LLM" y "que el LLM juzgue de quién es un RFC"). Se tratan como entradas nuevas del dueño.

## Decisiones del dueño (11-nov-2026)
1. **Subagentes:** la sesión se reinicia desde `C:\Users\hazae\proyectos\qa-cx-automation` para que `.claude/agents/` se cargue con sus nombres.
2. **Métricas en `js/`:** `metricas-bi` escribe `js/metricas.js` y sus pruebas (`js/tests/metricas*.test.js`) como excepción aprobada a la tabla de propiedad. Fuente única: la usan el nodo Code de W3 (vía `ensamblar.mjs`) y el ejecutor local `metricas/calcular.mjs`.
3. **Contrato:** aprobada la lista de métricas y ámbitos nuevos. `nombre_metrica`: `coincidencia_banda`, `diferencia_nota`, `acuerdo_sistema_escenario`, `acuerdo_humano_escenario`, `d1_coincidencia`, `criticos_solo_llm`, `tasa_anomalias`, `costo_lote`. `ambito_metrica`: `identidad`, `banda`. `falsos_positivos` y `falsos_negativos` (ya existentes) cubren "fallas inventadas" y "fallas no vistas", con `origen` = JS, LLM o HIBRIDO. Lo aplica `contrato-datos` (`glosario.md`, `sheets.md`).
4. **Tres bandas:** solo en el ejecutor local (lee `_escenarios.json`). W3 escribe en `metricas` lo que sale de las hojas. La hoja `escenarios` no cambia.
5. **Escenarios en Sheets:** `contrato-datos` genera un CSV de `calibracion_v1` con las 20 columnas del contrato; el dueño lo importa a la hoja `escenarios`.
6. **Consistencia:** fuera de n8n (modo nuevo de `verificar_openai.mjs`), 3 corridas × 24 con v1, **tope 0.40 USD**. Resultados a `metricas/resultados/`, sin tocar `evaluaciones`.
7. **Ajuste y validación:** la división 12/12, estratificada 4/4/4 por calidad, con semilla fija, **se hace y se commitea antes de A1**. En el Hito A, los detalles por conversación solo se muestran para la mitad de ajuste; la mitad de validación solo en agregado. `calibracion_v2` (lote externo) se decide después del Hito A.
8. **KB-08:** se aclara en una base de conocimiento v2, usada solo por v2; `calibracion_v1` con v1 se queda con la base vigente.
9. **Tablero:** Looker Studio sobre la hoja `metricas`.
10. **Costo del Hito A:** aprobado (estimación abajo).

## Hito A: métricas de v1

### A0. Preparación
- `contrato-datos`: (a) cambios de contrato de la decisión 3; (b) CSV de escenarios de `calibracion_v1` (decisión 5); (c) división ajuste/validación con semilla fija en `datos/lotes/calibracion_v1/` (decisión 7), con prueba que verifique 12/12 y 4/4/4. **Commit de la división antes de A1.**
- `workflows-n8n`: `construir_plantillas.mjs`, `ensamblar.mjs` y `ensamblar.mjs --local`. El dueño reimporta en el orden de `IMPORTAR.md` (99, 02, 01, 04, 00, 03) y republica. 01, 04 y 99 son los de la sección 0; 03 se reimporta otra vez en A2 cuando tenga el cálculo.
- El dueño revisa en su hoja `config`: `version_reglas` = `reglas_ce_v1`, `version_prompt` = `evaluador_ce_v1`, `modelo_evaluador` = `gpt-6-luna`, precios 0.10/0.50, `evaluar_al_ingerir_calibracion` = `no`, `tope_costo_lote_usd` = 0.25 y los umbrales de calibración. Confirma que las 24 de `calibracion_v1` están en `conversaciones` como `pendiente` y que sus 24 filas de `revision_humana` en Sheets están `calificada` e iguales al CSV commiteado (el orquestador compara por `conversation_id` y columnas `h_*` sobre una exportación).
- Disparador manual de W1: activarlo, poner `lote` = `calibracion_v1` y las versiones v1 en "Parámetros de calibración", ejecutar una vez.
- **Costo estimado (supuesto basado en la prueba B):** de 0.0021 a 0.0051 USD por evaluación (0.0041 USD por 2 sin reintentos; 0.0101 USD por 2 con reintentos) → 24 evaluaciones = **0.05 a 0.12 USD**, por debajo del tope de 0.25. Aprobado. Riesgo: cuota por minuto de Google Sheets (no medida) → las fallas van a `reproceso` y W4 las recoge; ninguna se pierde.

### A1. Evaluación
El dueño corre el disparador. El orquestador revisa totales: 24 evaluadas, estados, intentos, anomalías y costo real del lote contra el tope. El dueño exporta `evaluaciones`, `detalle_criterios`, `conversaciones` y `revision_humana` a CSV.

### A2. Métricas (`metricas-bi`; después `workflows-n8n` para W3)
`js/metricas.js`, funciones puras con pruebas sobre fixtures sintéticos:
- Nota y banda humanas: `h_seccion__*` → `factorDe` + `calcularNotaBase` (D5); cualquier `h_critico__* = si` → nota final 0 (D2); banda con `calcularCalidad`.
- Concordancia sistema vs humano: por subelemento clave (19), por sección (8), identidad (3) y crítico (12) (`si`/`no` ↔ `detectado`/`no_detectado`); acuerdo global contra `umbral_acuerdo_global`; diferencia de nota por conversación y promedio absoluto contra `umbral_diferencia_nota`; coincidencia de banda; kappa de Cohen por ámbito, solo informativo (con n = 24 se anota que es inestable).
- Críticos: precisión y recall contra la calificación humana, comparados con `precision_criticos_referencia` (se reporta n de positivos; si es muy pequeño, se dice).
- Dirección de errores: falsos negativos (el sistema no vio) y falsos positivos (inventó), por `origen` JS, LLM o HÍBRIDO.
- Tres bandas (solo ejecutor local): sistema vs humano, sistema vs escenario, humano vs escenario (escenario = `criterios_que_deben_fallar`, `errores_criticos_inyectados`, `secciones_esperadas`, `nota_esperada`, `calidad_esperada`).
- D1: para cada una de las 6 advertencias, si el sistema coincide con la sección humana o con D1 (reutiliza `diferenciaD1`); solo conteos.
- Críticos solo-LLM (reutiliza la lógica de `verificar_openai.mjs`), anomalías (`anomalias_llm`, intentos) y costo real por evaluación y por lote → propuesta de valores nuevos para `costo_estimado_por_evaluacion_usd` y `tope_costo_lote_usd` (`contrato-datos` los cambia con aprobación del dueño).
- Backlog §4b: cuántas conversaciones fallan a la vez `cierre.despedida` y `recapitulacion.cierre_inactividad`, contra la calificación humana.
- Regla de la decisión 7: el ejecutor local da detalle por conversación solo de la mitad de ajuste; de la mitad de validación, solo agregados.

W3: lee también `detalle_criterios`, nodo Code con `js/metricas.js` + pegamento, escribe `metricas` (formato largo existente) y la alerta de calibración con `armarAlertaCalibracion`. Nueva prueba de simulación de W3 en `workflows/tests/`. Ejecutor local `metricas/calcular.mjs` → `metricas/resultados/calibracion_v1__reglas_ce_v1__evaluador_ce_v1.json` + `.md`.

### A3. Resumen para la postulación (`documentacion`)
`metricas/resultados/resumen_v1.md` y sección "Resultados v1" del README: números principales, 3 hallazgos y límites explícitos (24 conversaciones sintéticas, un solo calificador humano, críticos con pocos positivos, kappa inestable, la calificación es del autor del sistema). Solo cifras que salgan de `metricas/resultados/`.

### A4. Cierre del hito
`revisor` → correcciones → commits por bloque con la convención → aprobación del dueño antes del push.

## Hito B: versión 2 (después de A)
- **B1 Consistencia:** modo `--consistencia --repeticiones 3` en `verificar_openai.mjs` (`evaluador-llm`), 3 corridas × 24 con v1. Costo estimado: 72 × 0.0021 a 0.0051 = 0.15 a 0.37 USD; **tope aprobado 0.40 USD**. Mide coincidencia por criterio (LLM e HÍBRIDO por separado; JS debe dar 100 %) y rango/desviación de la nota por conversación. Sirve para saber qué diferencia entre v1 y v2 es ruido.
- **B2 Priorizar el backlog con evidencia de A (solo mitad de ajuste a nivel de conversación):** tabla por entrada con métrica, n afectado y decisión: indulgencia en `preguntas_necesarias` y `ofrece_alternativas`; doble penalización (`informacion_correcta`/`congruencia`; `cierre.despedida`/`cierre_inactividad`); `ofrece_ayuda` en `reglas_ce_v2`; KB-08 (base v2); evidencia de todos los vicios de lenguaje; veto de JS a críticos solo-LLM con RFC genérico; intentos incorrectos de identidad como señal; incoherencia `critico.informacion_incorrecta` / `solucion.informacion_correcta`; `commentary`. Las decisiones que cambien el contrato se preguntan juntas.
- **B3 Reglas contra el sobreajuste:** v2 solo se diseña con errores de la mitad de ajuste y solo con reglas generales (rúbrica o KB, nunca reglas por conversación). v2 se reporta por separado en la mitad de validación. Límite honesto: el Hito A ya muestra agregados de las 24; la separación protege el diseño, no borra lo visto. `calibracion_v2` se decide después del Hito A.
- **B4 v2:** `evaluador_ce_v2` (`evaluador-llm`) y/o `reglas_ce_v2` (`contrato-datos` para la rúbrica, `reglas-js` para el código); v1 intactos. Base de conocimiento v2 con KB-08 aclarada, solo para v2. Cambiar la ruta de la plantilla del evaluador en `construir_plantillas.mjs` (límite conocido), reensamblar, reimportar y correr el disparador manual con la versión v2 (crea filas nuevas por llave; no toca las de v1). Costo ≈ 24 × 0.002 a 0.005 = 0.05 a 0.12 USD más reintentos (se confirma antes de correr). Métricas v1 vs v2 sobre el mismo lote, con la mitad de validación por separado.
- **B5 Tablero:** especificación paso a paso de Looker Studio (`metricas-bi`) sobre la hoja `metricas`: acuerdo por origen y sección, precisión/recall de críticos, diferencia de nota, v1 vs v2, costo y fallos.
- Cierre: `revisor`, resumen + preguntas de entrevista, explicación del dueño, commits; **`fase-4-cierre` y push solo con aprobación del dueño**.

## Reglas
- Ninguna corrida con costo sin estimación y aprobación previa; se reporta el costo real contra la estimación.
- Commits con `Subagente: <nombre>`, `git add` por rutas, `.env` fuera, checks antes de push (rama, árbol limpio, lista de commits).
- No se inventan cifras: lo que no esté en `metricas/resultados/` se escribe "pendiente".

## Verificación
- `node --test js/tests/*.test.js workflows/tests/*.test.js`, `construir_plantillas.mjs --verificar`, `ensamblar.mjs --verificar`.
- Pruebas de `js/metricas.js` con casos calculados a mano (acuerdo, kappa, precisión/recall, nota humana con D2/D5, banda).
- El ejecutor local y W3 deben dar las mismas cifras sobre las mismas exportaciones (prueba de igualdad).
- Revisión del `revisor` al cerrar cada hito.
