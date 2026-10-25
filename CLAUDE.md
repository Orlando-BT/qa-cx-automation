# Proyecto: QA automático de conversaciones de soporte con IA

## Cómo trabajamos (reglas permanentes)
Este proyecto se construye con subagentes de Claude Code coordinados por el agente principal (orquestador). Reglas:
- El orquestador no escribe la mayor parte del código: planea, reparte tareas a los subagentes de `.claude/agents/`, integra y verifica. Cada subagente solo escribe en las carpetas que le pertenecen (ver "Subagentes y propiedad de archivos").
- La fuente de verdad compartida es la carpeta `contrato/`. Ningún subagente inventa nombres de campos, hojas, columnas o valores que no estén en el contrato. Si falta algo, se detiene y lo reporta al orquestador; el contrato solo cambia con mi aprobación.
- Cada fase empieza en modo plan: el orquestador me presenta qué subagentes lanzará, en qué orden o en paralelo, qué archivos tocará cada uno y qué riesgos ve. Espera mi aprobación.
- Al cerrar cada fase, el subagente `revisor` verifica todo lo producido contra el contrato antes de que yo apruebe.
- Al cerrar cada fase, el orquestador me entrega un resumen en lenguaje sencillo: qué se construyó, cómo funciona, qué decisiones se tomaron y por qué, qué alternativas se descartaron y 3 a 5 preguntas que probablemente me hagan en una entrevista técnica sobre esa fase. Luego me pide que explique la fase con mis palabras; si mi explicación tiene huecos, los repasa conmigo.
- `docs/decisiones.md` lo escribo yo. El subagente `documentacion` mantiene `docs/registro-tecnico.md` con el detalle técnico.
- Hacer commit al cerrar cada fase aprobada.
- No inventes datos, resultados ni métricas. Si algo es un supuesto, márcalo como supuesto.
- Hay pasos que solo hago yo y ningún agente puede sustituir: la calificación humana del lote de calibración, cargar credenciales en n8n, importar y ejecutar los workflows en mi n8n, y crear cuentas (OpenAI, Anthropic, HubSpot, Telegram).

## Mi contexto
- Más de 4 años en Customer Experience en SaaS B2B: líder de soporte (L1 y L2) y analista de calidad (cédulas de monitoreo, calibraciones, feedback).
- Ya construí flujos de n8n en producción (webhook, API REST, Google Sheets, tablero de indicadores).
- Mi proyecto anterior (Data Career Copilot) separa la interpretación semántica con LLM del scoring determinista en JavaScript. Este proyecto sigue el mismo principio.
- Stack: n8n local en Docker, API de OpenAI (evaluador), API de Anthropic (generador del simulador), Google Sheets, Telegram, Data Studio, GitHub. En etapas posteriores: HubSpot, MCP en n8n y, opcionalmente, BigQuery y Streamlit.
- Nivel: JavaScript y Python básicos, SQL intermedio. Explícame el código que escribas.

## Objetivo
Evaluar automáticamente la calidad de conversaciones de soporte por chat con una rúbrica, medir qué tan confiable es esa evaluación contra mi evaluación humana y monitorear el sistema con alertas. Contexto ficticio: soporte por chat de un software contable en la nube para pymes en México (CFDI, cancelaciones, inventario, permisos de usuarios, pagos).

## Principio de diseño (obligatorio)
- Todo lo verificable con reglas, listas, expresiones regulares o timestamps se evalúa en JavaScript.
- El LLM solo hace lo que requiere comprensión de lenguaje: juicios semánticos, clasificación de tema dentro de un catálogo cerrado, errores de ortografía clasificados por gravedad, e identificación del mensaje donde se da información de la cuenta.
- El LLM devuelve juicios con evidencia (números de mensaje y justificación). Nunca calcula la nota final.
- JavaScript valida la respuesta del LLM, aplica umbrales, pondera, decide errores críticos y calcula la nota.
- Antes de enviar la conversación al LLM, JavaScript extrae y enmascara datos personales (correo, RFC, teléfono y nombre del titular) con marcadores como [EMAIL_1]. Detalle en `contrato/glosario.md`.
- Reglas, umbrales, listas y tiempos viven en configuración editable, no escritos en el código.
- La verdad del escenario generado nunca viaja con la conversación.

## Arquitectura (workflows de n8n)
### Workflow 0: Simulador (generación de conversaciones y demo)
1. Form Trigger con campos opcionales: tema, calidad deseada (buena, regular, mala, aleatoria), error crítico a inyectar, cantidad de conversaciones y lote destino (`demo`, `calibracion_v1`, `calibracion_v2`...).
2. JS: completar el escenario, elegir una cuenta de la hoja `cuentas` y generar ID.
3. Claude API: generar la conversación con el formato exacto del payload y timestamps coherentes.
4. JS: validar estructura y orden de timestamps; reintentar una vez si falla.
5. Sheets: guardar la verdad del escenario en `escenarios`, junto con modelo generador, versión del prompt de generación y costo de generación.
6. JS: convertir los mensajes en texto legible (emisor, hora y texto por línea) para revisión humana.
7. Sheets: guardar una copia en `revision_humana` con ID, lote, texto legible y columnas vacías para mi calificación. Esta hoja no muestra resultados del sistema ni la verdad del escenario.
8. HTTP Request: POST al webhook de Ingesta solo con el payload y el lote como parámetro de consulta (`?lote=`).

### Workflow 1: Ingesta
1. Webhook POST que responde de inmediato con acuse de recibido.
2. JS: validar el payload (campos, tipos, fechas). Si es inválido: registrar en `log_errores` y enviar alerta operativa.
3. Sheets: deduplicar por ID de conversación + versión de reglas + versión de prompt.
4. Sheets: guardar como pendiente en `conversaciones`.
5. Execute Workflow: llamar a Evaluación. Los lotes de calibración se guardan pendientes sin evaluar (`evaluar_al_ingerir_calibracion` en `contrato/config.md`).
Disparador adicional manual para el lote de calibración: recibe lote y versión, crea las filas pendientes de esa versión y las pasa una por una al mismo workflow de Evaluación (detalle en `contrato/sheets.md`).

### Workflow 2: Evaluación
1. Sheets: cargar `config`, `listas`, `catalogo_temas`, `base_conocimiento` y la cuenta del cliente.
2. JS-1 Normalización: ordenar mensajes, timestamps a segundos, tiempos entre mensajes, separar agente y cliente, primeros y últimos mensajes del agente.
3. JS-2 Extracción y enmascaramiento: extraer correos, RFC, teléfonos y números de caso; comparar contra la cuenta; enmascarar.
4. JS-3 Reglas deterministas: todas las reglas [JS], cada una con resultado y evidencia.
5. JS-4 Construcción del prompt: criterios [LLM] e [HÍBRIDO], base de conocimiento, catálogo de temas y conversación enmascarada con mensajes numerados.
6. OpenAI: temperatura 0, salida estructurada en JSON, reintentos automáticos ante fallas de conexión.
7. JS-5 Validación de la respuesta: campos completos, valores permitidos, tema dentro del catálogo, números de mensaje existentes. Si falla, reenviar a OpenAI con el error explicado (máximo 2 intentos); si sigue fallando, salida de error y alerta operativa.
8. JS-6 Reglas híbridas: tipificación, escalamiento, orden de validación de identidad, umbrales de ortografía, confidencialidad.
9. JS-7 Scoring: secciones a Cumple, Parcial o No cumple; ponderaciones; errores críticos; nota final; cumplimiento de meta.
10. JS-8 Costo: tokens por precio configurado.
11. Sheets: guardar en `evaluaciones` y `detalle_criterios`; marcar la conversación como evaluada.
12. Alertas de calidad y costo (ver sección Alertas).

### Workflow de errores
Error Trigger que registra en `log_errores` el workflow, nodo, mensaje de error y conversación afectada, y envía alerta operativa por Telegram. Los nodos críticos (OpenAI, Claude, Sheets, Telegram) tienen activada la salida de error para no detener todo el lote.

### Workflow 4: Reproceso
Disparador programado (`reproceso_intervalo_min`) y manual. Toma las conversaciones en estado `reproceso` (falla de API después de los reintentos con espera de HTTP 429 y 5xx, o salida ambigua del LLM) y las reenvía una por una a Evaluación. Al superar `reproceso_max_intentos` las deja en `error` con alerta operativa. Nunca borra filas: ninguna conversación se pierde. En W2, la revisión de `falla_api` va antes que la de `valido`.

### Workflow 3: Métricas de calibración
Disparador manual. Lee `evaluaciones`, `revision_humana` (solo filas calificadas) y `escenarios` de un lote de calibración, calcula las métricas, las guarda en `metricas` con la versión evaluada y envía alerta de calibración si el acuerdo cae bajo el umbral.

## Alertas (Telegram, solo envío de mensajes)
- Operativas: fallo de cualquier workflow, payload inválido, respuesta del LLM inválida después de los reintentos. Envío inmediato.
- De calidad: error crítico detectado. Incluye ID de conversación, agente, tipo de error, número de mensaje y evidencia. En modo simulador se envía de inmediato; en modo lote se agrupa en un resumen al final de la ejecución.
- De costo: una ejecución o un lote supera el costo configurado.
- De calibración: el acuerdo con la evaluación humana cae por debajo del umbral configurado.
- Toda alerta enviada se registra en una hoja `alertas`. Umbrales y destinatario viven en `config`.

## Datos: libro de Google Sheets
Hojas: `config`, `listas`, `catalogo_temas`, `base_conocimiento`, `cuentas`, `conversaciones`, `escenarios`, `revision_humana`, `evaluaciones`, `detalle_criterios`, `log_errores`, `alertas`, `metricas`. Columnas exactas, tipos y quién escribe cada hoja: `contrato/sheets.md`. `revision_humana` es la hoja donde califico a ciegas: no muestra resultados del sistema ni la verdad del escenario.

Payload del webhook: `contrato/payload.schema.json` (ejemplo en `contrato/ejemplos/`). Respuesta de OpenAI: `contrato/llm_output.schema.json`, solo elementos semánticos, nunca la nota. Resultado final: `contrato/evaluacion.schema.json`.

## Rúbrica (de mi autoría)
Ocho secciones con su ponderación: Apertura (5), Empatía y manejo de emociones (10), Diagnóstico de la necesidad (15), Solución y exactitud (35), Comunicación escrita (13), Recapitulación y registro (12), Ayuda adicional y encuesta (5), Cierre (5). Meta de calidad: 80. Además: validación de identidad y 12 errores críticos.

La fuente de verdad es `contrato/rubrica.md`: subelementos con ID estable, etiqueta [JS], [LLM] o [HÍBRIDO], clase (clave, complementario, informativo), cuándo no aplican, regla de agregación, renormalización, `nota_base` y `nota_final`, validación de identidad y errores críticos. Umbrales y tiempos: `contrato/config.md`. Nombres y valores permitidos: `contrato/glosario.md`.

## Lote de calibración
- `calibracion_v1`: 24 conversaciones generadas por el subagente `contrato-datos` (los lotes posteriores salen del simulador) y congeladas (no se regeneran).
- Distribución: 8 buenas, 8 regulares, 8 malas. Cada error crítico aparece al menos una vez. Casos difíciles: agente amable que no resuelve, agente que resuelve con tono seco, error crítico escondido, tipificación incorrecta, validación fuera de orden.
- Yo las califico a ciegas en `revision_humana`, sin abrir `evaluaciones` ni `escenarios` hasta terminar.
- Cualquier conversación del simulador queda guardada para revisión. Las que yo califique después pueden formar un lote nuevo (`calibracion_v2`), pero nunca se mezclan con un lote ya congelado.
- Las métricas de confiabilidad solo se calculan sobre conversaciones calificadas por mí y se reportan por lote, para que las comparaciones entre versiones de prompt sean sobre los mismos datos.

## Métricas
- Acuerdo por criterio, separando reglas JS y LLM.
- Falsos positivos y negativos de las reglas JS.
- Diferencia promedio de nota entre sistema y evaluación humana.
- Precisión y recall de errores críticos (meta de referencia de precisión: 95%).
- Costo promedio por evaluación y tasa de fallos.
- Comparación entre la intención del simulador y mi calificación (calidad del generador).

## Decisiones de diseño
Las decisiones de la Fase 0 (agregación de secciones, error crítico, base de conocimiento, umbrales de alertas, renormalización, calificación humana, `tipo_interaccion`) ya están tomadas y aplicadas en `contrato/`. El detalle técnico está en `docs/registro-tecnico.md` y mis razones en `docs/decisiones.md`. Cualquier decisión nueva que cambie el contrato me la preguntas antes de construir.

## Estructura del repositorio
```
contrato/        esquemas y definiciones compartidas (fuente de verdad)
datos/           cuentas, catálogo, listas, base de conocimiento, lotes de conversaciones
js/              código de los nodos Code de n8n (reglas, enmascaramiento, validación, scoring, costo)
js/tests/        pruebas con Node y fixtures
prompts/         prompts versionados (evaluador, generador, asistente MCP)
workflows/       workflows de n8n exportados en JSON, sin credenciales
metricas/        cálculo de métricas (Python o SQL), vistas, especificación del tablero
integraciones/   HubSpot y Telegram
mcp/             catálogo de consultas, servidor MCP y preguntas de prueba
docs/            README por secciones, registro técnico, diagramas, decisiones.md (mío)
```

## Contrato (`contrato/`)
Contiene (aprobado en la Fase 0):
- `payload.schema.json`: esquema JSON del payload del webhook.
- `llm_output.schema.json`: esquema JSON de la respuesta del evaluador, solo elementos semánticos.
- `evaluacion.schema.json`: estructura del resultado final por conversación y por criterio.
- `sheets.md`: cada hoja con columnas exactas, tipo de dato y quién la escribe.
- `rubrica.md`: subelementos de cada sección con su etiqueta [JS], [LLM] o [HÍBRIDO], ID estable de cada criterio y regla de agregación a Cumple, Parcial o No cumple (decisión mía).
- `config.md`: claves de configuración con valor por defecto (tiempos por canal, umbrales, meta, precios, umbrales de alertas, versiones).
- `glosario.md`: nombres de campos en español y sin ambigüedad (por ejemplo `agente`, nunca `agent_name`).
- `ejemplos/`: ejemplos ilustrativos que cumplen los esquemas.

## Subagentes y propiedad de archivos
| Subagente | Escribe en | Responsabilidad |
|---|---|---|
| `contrato-datos` | `contrato/`, `datos/` | Contrato, datos de referencia (cuentas, catálogo, listas, base de conocimiento) y lote sintético de calibración |
| `reglas-js` | `js/` (excepto `validador_llm.js` y `construccion_prompt.js`), `js/tests/` | Normalización, extracción y enmascaramiento, reglas deterministas, reglas híbridas, scoring y costo, validación del payload (`validador_payload.js`) y texto legible para revisión humana (`texto_legible.js`), con pruebas |
| `evaluador-llm` | `prompts/`, `js/validador_llm.js`, `js/construccion_prompt.js`, `js/tests/` | Prompt del evaluador, construcción del prompt (JS-4), validación de la respuesta del LLM, prompt del generador del simulador, versiones v1 y v2 |
| `workflows-n8n` | `workflows/` | Workflows 0 a 3 y de errores, alertas por Telegram, integrando el código de `js/` sin reescribirlo |
| `metricas-bi` | `metricas/` | Métricas de calibración, especificación del tablero de Data Studio y, opcional, vistas de BigQuery y app de Streamlit |
| `integracion-hubspot` | `integraciones/hubspot/`, `workflows/hubspot_*.json` | Carga de datos, captura de tickets y escritura de resultados en HubSpot, con app privada y luego OAuth 2.0 |
| `mcp-lideres` | `mcp/`, `workflows/mcp_*.json` | Catálogo de consultas, servidor MCP en n8n y evaluación con preguntas de prueba |
| `documentacion` | `docs/` (excepto `decisiones.md`) | README, registro técnico, diagramas y guion de demo |
| `revisor` | Nada (solo lectura) | Revisión de consistencia contra el contrato, secretos, principio JS vs LLM y pruebas |

## Fases de construcción
Cada fase: plan del orquestador, mi aprobación, subagentes, revisión de `revisor`, resumen para mí, mi explicación, commit.

### Fase 0: Contrato (terminada)
- `contrato-datos` redactó el contrato completo; aprobado por mí y por `revisor` (ver `docs/registro-tecnico.md`).

### Fase 1: Construcción en paralelo
- `contrato-datos`: datos de referencia y lote `calibracion_v1` (24 conversaciones con la distribución y casos difíciles definidos; verdad del escenario en archivo separado).
- `reglas-js`: todo el código determinista con pruebas que corran con Node sobre fixtures del lote.
- `evaluador-llm`: prompt v1 del evaluador, validador de respuesta y prompt del generador.
- `documentacion`: esqueleto del README y diagrama de arquitectura.
- Criterio de terminado: pruebas de `js/tests/` pasando y `revisor` sin hallazgos críticos.

### Fase 2: Workflows de n8n
- `workflows-n8n`: Ingesta, Evaluación, Errores, Simulador y Métricas, más alertas por Telegram, con instrucciones de importación y de credenciales que debo crear.
- Si tengo configurado un MCP de n8n para validar nodos, el subagente lo usa para verificar que los nodos existan en mi versión.
- Criterio de terminado: yo importo los workflows, cargo credenciales y el lote `demo` del simulador más los casos de prueba (payload de ejemplo, inválidos, duplicado, `sales`, sin agente, `fallo_api` forzado y reproceso) pasan por el flujo sin errores. `calibracion_v1` solo se ingesta como `pendiente`, sin evaluar, y se evalúa en la Fase 4 después de mi calificación a ciegas. Su verdad de escenarios no se carga en Google Sheets hasta terminar la Fase 3.

### Fase 3: Calibración (la hago yo)
- Califico a ciegas el lote en `revision_humana`, sin abrir `evaluaciones` ni `escenarios`.
- Ningún agente puede generar, sugerir ni completar esta calificación.

### Fase 4: Métricas, versión 2 y tablero
- `metricas-bi`: métricas v1 por lote.
- `evaluador-llm`: prompt v2 basado en las fallas observadas; se ejecuta sobre el mismo lote y `metricas-bi` compara v1 contra v2.
- `metricas-bi`: especificación paso a paso del tablero en Data Studio para que yo lo construya.
- `documentacion`: resultados y limitaciones en el README.

### Fase 5: HubSpot
- `integracion-hubspot`: propiedades personalizadas, carga de empresas, contactos y tickets, captura de tickets cerrados, escritura de resultados, nota con evidencia y tarea para el supervisor ante error crítico. Primero app privada; después OAuth 2.0 con manejo de renovación de tokens. Trabajo en una cuenta de prueba de desarrollador.

### Fase 5b: Rúbrica de Sales (junto con HubSpot)
- `contrato-datos`: rúbrica compacta de Sales asociada a `tipo_interaccion = sales`, sin cambiar el motor ni los esquemas existentes, y 8 a 10 conversaciones de Sales.
- Yo califico esas 8 a 10 conversaciones a ciegas en `revision_humana`; ningún agente puede generar, sugerir ni completar esa calificación.

### Fase 6: Agente MCP para líderes
- `mcp-lideres`: catálogo de consultas de solo lectura, servidor MCP en n8n con token de acceso, prompt del asistente y 20 a 30 preguntas de prueba con herramienta y parámetros esperados; mide aciertos, consistencia y costo.

### Fases opcionales
1. Selección inteligente para calibración (`reglas-js` + `workflows-n8n`).
2. Agente de feedback para asesores con aprobación humana (`evaluador-llm` + `workflows-n8n`).
3. Capa semántica en BigQuery y app de Streamlit para detalle de conversaciones (`metricas-bi`).
4. Agente semanal de Enablement (`evaluador-llm` + `workflows-n8n`).

## Entregables en GitHub
README (problema, solución, arquitectura, principio JS vs LLM, decisiones, resultados v1 vs v2, limitaciones), rúbrica y configuración, prompts versionados, workflows exportados sin credenciales, datos sintéticos, resultados, diagrama, `docs/registro-tecnico.md`, `docs/decisiones.md` y la carpeta `.claude/agents/` como evidencia de cómo dirigí el trabajo con subagentes.

## Restricciones
- Nada de credenciales, API keys ni datos reales en el repositorio.
- Usar modelos económicos y estimar el costo antes de ejecutar.
- Declarar en el README que los datos son sintéticos y sus limitaciones.
