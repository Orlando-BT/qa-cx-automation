# QA automático de conversaciones de soporte con IA

**Estado:** Fase 0 (contrato) terminada. Fase 1 (construcción en paralelo) en curso. Este README es un esqueleto: se completa a medida que avanzan las fases.

## Problema

En un equipo de soporte por chat, revisar la calidad de las conversaciones a mano es lento y cubre una fracción pequeña del volumen. Además, dos revisores pueden calificar distinto la misma conversación. Este proyecto automatiza la evaluación con una rúbrica y mide qué tan confiable es esa evaluación frente a la calificación humana.

Contexto ficticio: soporte por chat de Contamix, un software contable en la nube para pymes en México (CFDI, cancelaciones, inventario, permisos de usuarios, pagos).

## Solución

- Un conjunto de workflows de n8n recibe conversaciones, las evalúa con una rúbrica de ocho secciones (meta de calidad: 80), valida la identidad del cliente y detecta 12 errores críticos.
- El resultado se guarda en Google Sheets, con evidencia por criterio (números de mensaje y justificación).
- Se mide el acuerdo del sistema contra la evaluación humana sobre un lote de calibración y se compara una versión 1 del prompt contra una versión 2 sobre los mismos datos.
- Se monitorea con alertas por Telegram (operativas, de calidad, de costo y de calibración).
- Un simulador genera conversaciones sintéticas para demostrar el sistema en vivo y para formar nuevos lotes.

La rúbrica, los umbrales y las listas viven en configuración editable (`contrato/` y la hoja `config`), no en el código.

## Arquitectura

Cuatro workflows (W0 a W3) más el de errores (WE):

| Workflow | Función |
|---|---|
| W0 Simulador | Genera conversaciones sintéticas con la API de Anthropic y las envía a Ingesta. Guarda la verdad del escenario y una copia ciega para revisión humana. |
| W1 Ingesta | Webhook que valida, deduplica y guarda la conversación como pendiente. Incluye un disparador manual para reevaluar un lote de calibración con otra versión. |
| W2 Evaluación | Pipeline JS-1 a JS-8 con una llamada a OpenAI en medio. Guarda `evaluaciones` y `detalle_criterios`. |
| W3 Métricas | Disparador manual que calcula las métricas de calibración de un lote. |
| Errores | Registra en `log_errores` y envía alerta operativa. |

Diagrama completo, con las hojas que lee y escribe cada workflow: [`docs/arquitectura.mmd`](docs/arquitectura.mmd) (Mermaid).

Los nombres de hojas, columnas y campos son los de `contrato/`, que es la fuente de verdad compartida.

## Principio de diseño: JavaScript vs LLM

- Todo lo verificable con reglas, listas, expresiones regulares o timestamps se evalúa en JavaScript.
- El LLM solo hace lo que requiere comprensión de lenguaje: juicios semánticos, clasificación de tema dentro de un catálogo cerrado, errores de ortografía clasificados por gravedad e identificación del mensaje donde se da información de la cuenta.
- El LLM devuelve juicios con evidencia. **Nunca calcula la nota final.**
- JavaScript valida la respuesta del LLM, aplica umbrales, pondera, decide errores críticos y calcula `nota_base` y `nota_final`.
- Antes de enviar la conversación al LLM, JavaScript extrae y enmascara datos personales (correo, RFC, teléfono y nombre del titular) con marcadores como `[EMAIL_1]`.
- La verdad del escenario generado nunca viaja con la conversación.

Criterios de la rúbrica: 54 subelementos de sección (34 JS, 15 LLM, 5 híbridos), 3 de validación de identidad y 12 errores críticos (conteos del contrato).

## Cómo se trabajó con subagentes

El proyecto se construye con subagentes de Claude Code coordinados por un agente principal (orquestador). El orquestador planea, reparte, integra y verifica. Cada subagente solo escribe en sus carpetas y no inventa nombres que no estén en `contrato/`. Cada fase empieza en modo plan con aprobación del dueño, termina con revisión del subagente `revisor` y se cierra con commit. Las definiciones están en [`.claude/agents/`](.claude/agents/).

| Subagente | Escribe en | Responsabilidad |
|---|---|---|
| `contrato-datos` | `contrato/`, `datos/` | Contrato, datos de referencia y lote sintético de calibración |
| `reglas-js` | `js/` (excepto `validador_llm.js` y `construccion_prompt.js`), `js/tests/` | Normalización, enmascaramiento, reglas, scoring y costo, validación del payload (`validador_payload.js`) y texto legible para revisión humana (`texto_legible.js`), con pruebas |
| `evaluador-llm` | `prompts/`, `js/validador_llm.js`, `js/construccion_prompt.js`, `js/tests/` | Prompt del evaluador, construcción del prompt (JS-4), validación de la respuesta, prompt del generador, versiones v1 y v2 |
| `workflows-n8n` | `workflows/` | Workflows 0 a 3 y de errores, alertas por Telegram |
| `metricas-bi` | `metricas/` | Métricas de calibración y especificación del tablero |
| `integracion-hubspot` | `integraciones/hubspot/` | Integración con HubSpot (Fase 5) |
| `mcp-lideres` | `mcp/` | Agente MCP de consultas para líderes (Fase 6) |
| `documentacion` | `docs/` (excepto `decisiones.md`), `README.md` | README, registro técnico, diagramas, guion de demo |
| `revisor` | Nada (solo lectura) | Revisión contra el contrato, secretos, principio JS vs LLM y pruebas |

Hay pasos que solo hace el dueño: calificar a ciegas el lote de calibración, cargar credenciales en n8n, importar y ejecutar los workflows, y crear cuentas (OpenAI, Anthropic, HubSpot, Telegram). `docs/decisiones.md` también es suyo.

## Modelos

Elegidos en la Fase 1. El evaluador se probó con la API y acepta salida estructurada `json_schema` estricta. La verificación del generador sigue pendiente.

| Rol | Proveedor | Modelo |
|---|---|---|
| Evaluador | OpenAI | `gpt-6-luna` (precios en `config`: 0.10 USD entrada y 0.50 USD salida por millón de tokens) |
| Generador del simulador | Anthropic Por verificar al inicio de la Fase 2 (candidato: `claude-haiku-5-5`, SUPUESTO; precios por verificar) |

El costo estimado por evaluación (0.005 USD) y el tope por lote (0.25 USD) son provisionales y se recalcularán en la Fase 4.

## Estructura del repositorio

```
contrato/        esquemas y definiciones compartidas (fuente de verdad)
datos/           cuentas, catálogo, listas, base de conocimiento, lotes de conversaciones
js/              código de los nodos Code de n8n
js/tests/        pruebas con Node y fixtures
prompts/         prompts versionados (evaluador, generador, asistente MCP)
workflows/       workflows de n8n exportados en JSON, sin credenciales
metricas/        cálculo de métricas, vistas, especificación del tablero
integraciones/   HubSpot y Telegram
mcp/             catálogo de consultas, servidor MCP y preguntas de prueba
docs/            registro técnico, diagramas, guion de demo, decisiones.md
.claude/agents/  definición de los subagentes
```

Algunas carpetas aún no tienen contenido porque su fase no ha llegado.

## Datos sintéticos y limitaciones

- **Todos los datos son sintéticos.** La marca Contamix, las cuentas, los correos (dominios `.example`), los teléfonos y las conversaciones son ficticios. No hay datos reales de clientes.
- Las conversaciones del lote de calibración las genera un modelo de lenguaje (no son chats reales) y pueden ser más limpias o más predecibles que las reales.
- El lote de calibración es pequeño (24 conversaciones): las métricas tendrán poca precisión estadística. Por eso el coeficiente kappa se reporta solo como información.
- La calificación humana la hace una sola persona, que además diseñó la rúbrica; no se mide acuerdo entre varios revisores.
- El enmascaramiento solo detecta el nombre del titular de la cuenta; otros nombres llegan sin enmascarar. Un nombre de pila común puede enmascararse de más.
- Los resultados no son extrapolables a conversaciones reales ni a otros dominios sin una nueva calibración.
- Varios valores de configuración son supuestos (marcados **SUPUESTO** en `contrato/config.md`).

## Resultados v1 vs v2

**Pendiente.** Aún no hay calificación humana, así que no existen métricas de confiabilidad. Las métricas se publicarán aquí solo cuando existan en `metricas/resultados/`.

| Métrica | v1 | v2 |
|---|---|---|
| Acuerdo por criterio (JS y LLM por separado) | pendiente | pendiente |
| Falsos positivos y negativos de reglas JS | pendiente | pendiente |
| Diferencia promedio de nota vs evaluación humana | pendiente | pendiente |
| Precisión y recall de errores críticos | pendiente | pendiente |
| Costo promedio por evaluación | pendiente | pendiente |
| Tasa de fallos | pendiente | pendiente |
| Calidad del generador (intención vs calificación humana) | pendiente | pendiente |

## Siguientes pasos

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Contrato | Terminada |
| 1 | Datos de referencia y lote `calibracion_v1`, código JS con pruebas, prompt v1 y validador, esqueleto de documentación | En curso |
| 2 | Workflows de n8n y alertas por Telegram | Pendiente |
| 3 | Calificación humana a ciegas del lote (la hace el dueño) | Pendiente |
| 4 | Métricas v1, prompt v2, comparación y especificación del tablero | Pendiente |
| 5 y 5b | HubSpot y rúbrica de Sales | Pendiente |
| 6 | Agente MCP para líderes | Pendiente |

Fases opcionales: selección inteligente para calibración, agente de feedback con aprobación humana, capa semántica en BigQuery con Streamlit, agente semanal de Enablement.

## Más documentación

- [`docs/registro-tecnico.md`](docs/registro-tecnico.md): detalle técnico por fase.
- [`docs/decisiones.md`](docs/decisiones.md): decisiones del dueño del proyecto.
- [`contrato/`](contrato/): rúbrica, configuración, glosario, hojas y esquemas.
