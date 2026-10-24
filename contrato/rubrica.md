# Rúbrica de calidad (contrato)

Rúbrica de autoría del dueño, formalizada para el sistema. Estado: Fase 0 aprobada; cambios de Fase 1 aprobados por el dueño el 23-oct-2026 (sección 4, 3.11 y confidencialidad).

**Identidad de esta rúbrica:** `tipo_interaccion = ce` (Customer Experience), `version_reglas = reglas_ce_v1`, prompt del evaluador `evaluador_ce_v1`.

## 0. Rúbricas por tipo de interacción

- Cada rúbrica está asociada a un `tipo_interaccion` (`ce`, `sales`) y se versiona con `version_reglas` (`reglas_<tipo>_vN`). No existe un identificador de rúbrica aparte: `reglas_ce_v1` **es** la rúbrica CE v1. Así no hay dos versiones que deban moverse juntas.
- La conversación trae `tipo_interaccion` en el payload. Ingesta y Evaluación toman `version_reglas` y `version_prompt` de las filas de `config` con ese `tipo_interaccion` (ver `config.md`, sección 0).
- El motor (JS-1 a JS-8) es genérico. Recibe como datos la definición de la rúbrica activa:
  - secciones, pesos, subelementos, origen, clase y reglas de `no_aplica`;
  - parámetros de `config`, `listas`, `catalogo_temas` y `base_conocimiento` filtrados por `tipo_interaccion`:
    - en `config`, el tipo concreto tiene precedencia sobre `todos`;
    - en `listas`, `catalogo_temas` y `base_conocimiento` se cargan las filas del tipo **unidas** a las de `todos`.

  Cómo se empaqueta esa definición en código lo decide `reglas-js`.
- `payload.schema.json`, `evaluacion.schema.json` y las hojas de resultados (`evaluaciones`, `detalle_criterios`, `metricas`) no dependen de las secciones de una rúbrica concreta. Agregar la rúbrica de Sales (Fase 5b) es **aditivo**:
  - un documento de rúbrica nuevo;
  - filas de `config`, `listas` y `catalogo_temas` con `tipo_interaccion = sales`;
  - un esquema de salida del LLM propio (`llm_output_sales.schema.json`);
  - un prompt `evaluador_sales_v1`;
  - una hoja `revision_humana_sales` con columnas derivadas con la misma regla del glosario.
- `llm_output.schema.json` y la hoja `revision_humana` corresponden a la rúbrica CE.
- Este documento es solo la rúbrica CE. La de Sales no se redacta en esta fase.

- Cada subelemento tiene un ID estable (`seccion.subelemento`), una etiqueta de origen y una clasificación.
- Etiquetas:
  - [JS]: regla determinista (listas, expresiones regulares, timestamps, metadatos).
  - [LLM]: juicio semántico del evaluador.
  - [HÍBRIDO]: el LLM entrega un insumo semántico con evidencia y JS decide el resultado.
- Clasificación:
  - `clave`: si falla, la sección queda `no_cumple`.
  - `complementario`: si falla, la sección baja a `parcial`, o a `no_cumple` por desempate.
  - `informativo`: se registra, pero no entra en la agregación.
- Resultado de cada subelemento: `cumple`, `no_cumple` o `no_aplica`. El sistema nunca asigna `parcial` a un subelemento.
- Los nombres de listas (`clave_lista`) y claves de configuración citados están definidos en `glosario.md` y `config.md`.
- Valores marcados SUPUESTO no vienen de `CLAUDE.md` ni de decisiones del dueño; son editables en `config`.

## 1. Secciones y pesos

| # | Sección (ID) | Peso |
|---|---|---|
| 1 | `apertura` | 5 |
| 2 | `empatia` | 10 |
| 3 | `diagnostico` | 15 |
| 4 | `solucion` | 35 |
| 5 | `comunicacion` | 13 |
| 6 | `recapitulacion` | 12 |
| 7 | `ayuda_adicional` | 5 |
| 8 | `cierre` | 5 |
| | **Total** | **100** (5+10+15+35+13+12+5+5 = 100) |

Meta de calidad: **80** (`config.meta_calidad`).

## 2. Reglas de agregación

### 2.1 Subelementos → sección (decisión D1)

Para cada sección, considerando solo subelementos `clave` y `complementario` cuyo resultado no sea `no_aplica` (los `no_aplica` salen del numerador y del denominador; los `informativo` se ignoran siempre):

1. Si no queda ningún subelemento aplicable → sección `no_aplica`.
2. Si falla (`no_cumple`) cualquier subelemento `clave` → `no_cumple`.
3. Si no falla ningún clave:
   - Todos los aplicables cumplen → `cumple`.
   - Fallan complementarios y la proporción `complementarios_fallidos / complementarios_aplicables` es **mayor que** `config.umbral_desempate_complementarios` (0.5) → `no_cumple`.
   - Fallan complementarios con proporción menor o igual al umbral → `parcial`.

Si una sección no tiene complementarios aplicables y todos los clave cumplen → `cumple`.

Ejemplos (sección `apertura`, 2 clave y 6 complementarios, todos aplicables):

| Caso | Clave fallidos | Complementarios fallidos | Proporción | Resultado |
|---|---|---|---|---|
| A | 0 | 0 de 6 | 0.00 | `cumple` |
| B | 0 | 2 de 6 | 0.33 | `parcial` |
| C | 0 | 3 de 6 | 0.50 (no es mayor que 0.5) | `parcial` |
| D | 0 | 4 de 6 | 0.67 | `no_cumple` |
| E | 1 (`apertura.aviso_privacidad`) | 0 de 6 | — | `no_cumple` |

Ejemplo con `no_aplica` (sección `comunicacion` en una conversación sin esperas). En apertura no hay complementarios que puedan quedar `no_aplica`, por eso se usa otra sección:
- La clave `no_excede_espera` y los complementarios `pide_espera`, `agradece_espera` y `retoma_a_tiempo` quedan `no_aplica`.
- Quedan 1 clave aplicable (`ortografia`) y 6 complementarios aplicables (`signos_apertura`, `tecnicismos`, `frases_negativas`, `vicios_lenguaje`, `redaccion`, `congruencia`).

| Caso | Clave fallidos | Complementarios fallidos | Proporción | Resultado |
|---|---|---|---|---|
| F | 0 de 1 | 1 de 6 (`signos_apertura`) | 0.17 | `parcial` |
| G | 0 de 1 | 4 de 6 | 0.67 | `no_cumple` |

### 2.2 Secciones → nota (decisión D5, renormalización)

`factor`: `cumple` = 1, `parcial` = 0.5, `no_cumple` = 0. Las secciones `no_aplica` se excluyen.

```
nota_base = suma(peso_i × factor_i) / suma(peso_i de secciones aplicables) × 100
```

Se redondea a `config.decimales_nota` (2, SUPUESTO) decimales, con redondeo aritmético (mitad hacia arriba).

**Ejemplo numérico completo (verificado):**

| Sección | Peso | Resultado | Factor | Peso × factor |
|---|---|---|---|---|
| apertura | 5 | cumple | 1 | 5 |
| empatia | 10 | parcial | 0.5 | 5 |
| diagnostico | 15 | cumple | 1 | 15 |
| solucion | 35 | parcial | 0.5 | 17.5 |
| comunicacion | 13 | cumple | 1 | 13 |
| recapitulacion | 12 | no_cumple | 0 | 0 |
| ayuda_adicional | 5 | no_aplica | — | excluida |
| cierre | 5 | cumple | 1 | 5 |

- Suma de pesos aplicables: 5 + 10 + 15 + 35 + 13 + 12 + 5 = **95**.
- Suma de puntos: 5 + 5 + 15 + 17.5 + 13 + 0 + 5 = **60.5**.
- nota_base = 60.5 / 95 × 100 = 63.6842… → **63.68**.
- 63.68 < 80 → no cumple la meta.

Ejemplo sin secciones `no_aplica`: todas `cumple` salvo `solucion` en `parcial` → 100 − 17.5 = **82.5** sobre 100 → cumple la meta.

Si todas las secciones quedan `no_aplica` (no debería ocurrir con una conversación válida), no se genera evaluación. Se registra en `log_errores` con `tipo_error = evaluacion_sin_secciones_aplicables`, se envía alerta operativa y la conversación queda en estado `error`.

### 2.3 Errores críticos (decisión D2)

- `nota_base`: se calcula como en 2.2, sin considerar errores críticos.
- `nota_final`: 0 si hay al menos un error crítico `detectado`; si no, igual a `nota_base`.
- `nota_final` es la nota oficial. `cumple_meta` compara `nota_final` con `config.meta_calidad` según `config.meta_comparacion_inclusiva`: `si` → ≥ (por defecto, SUPUESTO); `no` → >.
- Ejemplo: nota_base 82.5 y `critico.mala_actitud` detectado → nota_final 0 → `cumple_meta = false`. Sin críticos → nota_final 82.5 → `cumple_meta = true`.

Los errores críticos no cambian el resultado de las secciones; un subelemento ligado a un crítico (por ejemplo `apertura.toma_a_tiempo`) afecta su sección por la regla D1 y además activa el crítico.

### 2.4 Bandas de calidad (`buena`, `regular`, `mala`)

Decisión del dueño. Los límites son claves editables de `config` (SUPUESTO).

| Calidad | Condición |
|---|---|
| `buena` | `nota_final ≥ config.calidad_buena_nota_min` (80) y sin errores críticos. |
| `regular` | `config.calidad_regular_nota_min` (60) ≤ `nota_final` < 80 y sin errores críticos (es decir, de 60 a 79.99). |
| `mala` | `nota_final` < 60, o al menos un error crítico detectado. |

Usos:
- **Generación del lote** (`contrato-datos`, simulador): la `calidad_esperada` del escenario debe corresponder a la nota que la conversación merece con esta rúbrica.
- **Métricas** (`metricas-bi`, `acuerdo_generador_humano`): la nota humana se calcula a partir de `h_seccion__*` y `h_critico__*` con las reglas 2.2 y 2.3, y se convierte en calidad con esta misma tabla.

**Lote `calibracion_v1`:** hay 12 errores críticos y 8 conversaciones malas, y cada crítico debe aparecer al menos una vez. Por eso algunas conversaciones malas llevarán más de un crítico.

## 3. Subelementos por sección

Columnas:
- **ID**
- **Origen**
- **Clase**
- **Regla:** qué hace JS y qué hace el LLM.
- **`no_aplica` cuando**

Los subelementos `clave` tienen su justificación en la sección 3.9.

Convención para detectar frases: JS compara sin acentos y sin distinguir mayúsculas contra la lista indicada. "Mensajes del agente" excluye los del cliente.

### 3.1 Apertura (`apertura`, peso 5)

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `apertura.saludo` | JS | complementario | Primer mensaje del agente coincide con lista `saludo`. | Nunca. |
| `apertura.bienvenida` | JS | complementario | Primeros `config.apertura_mensajes_agente` (2, SUPUESTO) mensajes del agente coinciden con `bienvenida`. | Nunca. |
| `apertura.marca` | JS | complementario | Primeros `config.apertura_mensajes_agente` mensajes del agente contienen `config.marca`. | Nunca. |
| `apertura.nombre_agente` | JS | complementario | Primeros `config.apertura_mensajes_agente` mensajes del agente contienen el nombre de pila de `agente`. | Nunca. |
| `apertura.ofrece_ayuda` | JS | complementario | Primeros `config.apertura_mensajes_agente` mensajes del agente coinciden con `ofrece_ayuda` (ofrece ayuda o confirma la solicitud). | Nunca. |
| `apertura.aviso_privacidad` | JS | clave | Algún mensaje del agente, antes de pedir datos de identidad o, si no los pide, en los primeros `config.apertura_privacidad_mensajes_agente` (3, SUPUESTO) mensajes del agente, coincide con `aviso_privacidad`. | Nunca. |
| `apertura.nombre_cliente` | JS | complementario | Algún mensaje del agente dentro de los primeros `config.apertura_privacidad_mensajes_agente` coincide con `pide_nombre_cliente` o contiene el nombre de pila de `cuentas.titular`. | Nunca. |
| `apertura.toma_a_tiempo` | JS | clave | `timestamp(primer mensaje del agente) − timestamp(primer mensaje del cliente) ≤ config.chat_primera_respuesta_seg`. Si no hay ningún mensaje del agente → `no_cumple`. Si falla, activa `critico.no_toma_a_tiempo`. | Si el primer mensaje de la conversación es del agente (contacto saliente), salvo conversación sin mensajes del agente (3.12), que siempre es `no_cumple`. |

### 3.2 Empatía y manejo de emociones (`empatia`, peso 10)

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `empatia.identifica_emocion` | LLM | complementario | El agente reconoce la emoción del cliente (`emocion_cliente` de la salida del LLM). | El LLM lo marca `no_aplica` solo si `emocion_cliente.emocion = neutral` y no hay señal emocional. JS-5 rechaza `no_aplica` con otra emoción. |
| `empatia.muestra_empatia` | LLM | clave | El agente valida la situación del cliente con frases empáticas pertinentes, no genéricas. | Cuando la emoción del cliente es `neutral` y no hay situación que validar. **Lo decide el LLM**: debe devolver `emocion_cliente.emocion = neutral` y explicar en `justificacion` por qué no hay situación que validar. JS-5 rechaza la respuesta si marca `no_aplica` con una emoción distinta de `neutral`. |
| `empatia.cordialidad` | LLM | clave | Trato amable y respetuoso en toda la conversación; detecta tono seco o cortante. | Nunca. |
| `empatia.lenguaje_acorde` | LLM | complementario | Registro adecuado al cliente (formalidad, sin tecnicismos innecesarios). | Nunca. |
| `empatia.asertividad` | LLM | complementario | Comunica límites y negativas con claridad y respeto. | Si no hubo nada que negar o limitar. |
| `empatia.mayusculas_sostenidas` | JS | complementario | No hay en mensajes del agente `config.mayusculas_min_palabras_consecutivas` (3, SUPUESTO) o más palabras seguidas en mayúsculas de al menos `config.mayusculas_min_longitud_palabra` (4, SUPUESTO) letras, ignorando la lista `sigla_permitida`. | Nunca. |

### 3.3 Diagnóstico de la necesidad (`diagnostico`, peso 15)

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `diagnostico.preguntas_necesarias` | LLM | complementario | El agente hace las preguntas necesarias para entender el caso (según el artículo de la base). | Si la solicitud llega completa y no requiere preguntas. |
| `diagnostico.solicitudes_detectadas` | LLM | clave | Todas las solicitudes del cliente (`solicitudes_cliente`) fueron reconocidas por el agente. | Nunca. |
| `diagnostico.solicitudes_atendidas` | LLM | clave | Todas las solicitudes del cliente fueron atendidas (`solicitudes_cliente[].atendida`). JS verifica que el resultado sea coherente: si alguna solicitud tiene `atendida = false`, el resultado debe ser `no_cumple`; si no lo es, JS-5 lo trata como respuesta inválida. | Nunca. |
| `diagnostico.numero_preguntas` | JS | informativo | Sea `m` el mínimo de todos los `solicitudes_cliente[].mensajes_atencion` de la salida del LLM (primer mensaje en que el agente atiende alguna solicitud). JS cuenta los mensajes del agente con signo `?` anteriores a `m` y registra el número como evidencia. Resultado `cumple` si ≥ 1, `no_cumple` si 0. No entra en la agregación. | Si ninguna solicitud tiene `mensajes_atencion`, o si no hay mensajes del agente antes de `m`. |

### 3.4 Solución y exactitud (`solucion`, peso 35)

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `solucion.informacion_correcta` | LLM | clave | La información dada coincide con la base de conocimiento (artículos citados en `articulos_base_usados`). | Nunca. |
| `solucion.informacion_completa` | LLM | complementario | No omite pasos, requisitos, plazos o condiciones relevantes del artículo. | Nunca. |
| `solucion.apego_proceso` | LLM | clave | Sigue el proceso definido en la base (orden de pasos, políticas). | Nunca. |
| `solucion.ofrece_alternativas` | LLM | complementario | Ofrece alternativas cuando la solución principal no es posible. | Si la solución principal se pudo dar. |
| `solucion.escala_cuando_requiere` | HÍBRIDO | clave | Usa `requiere` (ver "Cálculo de `requiere`" debajo de esta tabla). **JS:** cumple si `metadatos_caso.escalado = true`; `no_cumple` si es `false`. | Si `requiere = false`. |
| `solucion.no_escala_innecesario` | HÍBRIDO | complementario | Usa `requiere`. **JS:** cumple si `metadatos_caso.escalado = false`; `no_cumple` si es `true` (escaló algo que el soporte debía resolver). | Si `requiere = true`. |
| `solucion.campos_obligatorios` | JS | complementario | Para la fila de `catalogo_temas` cuya `tipificacion_valida` es igual a `tipificacion_agente`, cada campo de `campos_obligatorios` está en `campos_capturados` con valor `presente`. | Si `tipificacion_agente` no existe en el catálogo (lo cubre `recapitulacion.tipificacion`) o la fila no tiene campos obligatorios. |
| `solucion.seguimiento_en_plazo` | JS | complementario | Si el caso no queda cerrado, algún mensaje del agente coincide con `plazo_seguimiento`, y el plazo capturado convertido a horas hábiles es ≤ `config.seguimiento_plazo_max_horas_habiles` (48, valor SUPUESTO). Antes de aplicar `plazo_seguimiento`, JS convierte los números escritos con palabras a cifras con la lista `numero_en_palabras` ("dos días hábiles" → "2 dias habiles"). Conversión de unidades y minutos: ver 3.11. | Si `estado_caso` es `cerrado` o `sin_caso`. |

**Cálculo de `requiere` (escalamiento):**
- **LLM:** `insumos_hibridos.situacion_escalamiento.situacion_requiere_escalamiento`. Dice si, según la base de conocimiento, la situación descrita es un caso que se escala, con mensajes y justificación.
- **JS:** toma las filas activas de `catalogo_temas` (las del `tipo_interaccion` de la conversación unidas a las de `todos`) cuyo `tema` es igual a `tema.valor` del LLM (ya validado en JS-5).
  - Todas las filas dicen `si` → `requiere = true`.
  - Todas las filas dicen `no` → `requiere = false`.
  - Alguna dice `segun_caso`, o las filas no coinciden entre sí → `requiere` = valor del LLM.
- El insumo del LLM se guarda siempre como evidencia, aunque el catálogo decida.
- Exactamente uno de los dos subelementos de escalamiento aplica en cada conversación.

### 3.5 Comunicación escrita (`comunicacion`, peso 13)

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `comunicacion.ortografia` | HÍBRIDO | clave | **LLM:** lista `errores_ortografia` (mensaje, error, corrección, gravedad) solo en mensajes del agente. **JS:** descarta errores en mensajes inexistentes o del cliente; `no_cumple` si graves ≥ `config.ortografia_umbral_graves` (1) o menores ≥ `config.ortografia_umbral_menores` (3). | Nunca. |
| `comunicacion.signos_apertura` | JS | complementario | Oraciones del agente que terminan en `?` o `!` sin `¿` o `¡` correspondiente; `no_cumple` si las omisiones son > `config.signos_apertura_max_omisiones` (0, SUPUESTO). | Si el agente no hace preguntas ni exclamaciones. |
| `comunicacion.tecnicismos` | JS | complementario | Ningún mensaje del agente contiene términos de `termino_prohibido` (tecnicismos y sistemas internos). | Nunca. |
| `comunicacion.frases_negativas` | JS | complementario | Ningún mensaje del agente contiene `frase_negativa`. | Nunca. |
| `comunicacion.vicios_lenguaje` | JS | complementario | Ningún mensaje del agente contiene `vicio_lenguaje`. | Nunca. |
| `comunicacion.redaccion` | LLM | complementario | Redacción clara, ordenada y comprensible. | Nunca. |
| `comunicacion.congruencia` | LLM | complementario | Los mensajes son coherentes entre sí y con lo que pregunta el cliente. | Nunca. |
| `comunicacion.pide_espera` | JS | complementario | Toda espera debe anunciarse. Un **retraso de respuesta** es un intervalo mayor que `config.chat_umbral_espera_seg` (60, SUPUESTO) entre un mensaje del cliente y el siguiente mensaje del agente, sin contar la primera respuesta. "Anunciada" (precedida) significa que, si el agente necesita más tiempo, envía un mensaje `pide_espera` dentro de ese umbral después del mensaje del cliente; eso abre un episodio de espera y ya no hay retraso de respuesta. Cumple si no hay retrasos de respuesta; `no_cumple` si hay al menos uno (evidencia: mensaje del cliente, mensaje del agente y segundos). | Si no hay episodios de espera ni retrasos de respuesta. |
| `comunicacion.agradece_espera` | JS | complementario | El mensaje que cierra cada episodio de espera coincide con `agradece_espera`. | Si no hay episodios de espera. |
| `comunicacion.retoma_a_tiempo` | JS | complementario | Dentro de cada episodio, ningún intervalo entre mensajes consecutivos del agente supera `config.chat_retomar_espera_seg` (120, SUPUESTO). | Si no hay episodios de espera. |
| `comunicacion.no_excede_espera` | JS | clave | La duración de cada episodio de espera (desde el mensaje `pide_espera` hasta el mensaje que lo cierra) es ≤ `config.chat_espera_maxima_seg` (300, SUPUESTO). | Si no hay episodios de espera. |

Episodio de espera: ver `glosario.md`, sección 7. Los episodios abiertos (sin cierre) se tratan en 3.11.

**Gravedad de los errores de ortografía (SUPUESTO).** El LLM la asigna con estas definiciones, que también van en el prompt:

| Gravedad | Definición | Ejemplos |
|---|---|---|
| `grave` | Cambia el sentido de la palabra o la frase, o es un error evidente para cualquier lector. | Acento diacrítico que cambia el sentido (`si`/`sí`, `tu`/`tú`, `el`/`él`, `mas`/`más`); confusiones homófonas (`haber`/`a ver`, `hay`/`ahí`/`ay`, `echo`/`hecho`); cambio de letra con otra palabra o error evidente (`b`/`v`, `s`/`c`/`z`, `h` omitida o sobrante: "aser", "ablar"). |
| `menor` | No cambia el sentido. | Acento omitido en palabra no diacrítica ("factura electronica"); error de dedo aislado ("facutra"); mayúscula omitida al inicio de oración. |

Solo cuentan errores en mensajes del agente. La puntuación de apertura (`¿`, `¡`) no cuenta aquí: la evalúa `comunicacion.signos_apertura`.

### 3.6 Recapitulación y registro (`recapitulacion`, peso 12)

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `recapitulacion.recapitula` | LLM | clave | Antes del cierre, el agente resume la solicitud y la solución o el siguiente paso. | Cuando `termina_por_inactividad = true` (ver 3.10). **Lo impone JS** (JS-6/JS-7), sin importar lo que responda el LLM. Si `termina_por_inactividad = false`, JS-5 rechaza un `no_aplica` del LLM en este criterio. |
| `recapitulacion.uso_solucion_seguimiento` | HÍBRIDO | complementario | **JS:** detecta en mensajes del agente `palabra_solucion` y `palabra_seguimiento`. Palabra esperada: `cerrado` → "solución"; `abierto` o `en_seguimiento` → "seguimiento". `no_cumple` si no usa la esperada o usa la contraria. **LLM:** `insumos_hibridos.uso_solucion_seguimiento.uso_correcto` (si el uso corresponde a lo que realmente pasó: problema resuelto en la conversación o pendiente). **JS** combina: cumple solo si usa la palabra esperada y el LLM dice `uso_correcto = true`. | Si `estado_caso` es `sin_caso`, o si la conversación termina por inactividad del cliente (ver 3.10). |
| `recapitulacion.informa_numero_caso` | JS | clave | Algún mensaje del agente contiene un número con patrón `CASO-[0-9]{5}`. | Si `numero_caso` es `null` (el problema lo cubre `critico.no_genera_caso`). |
| `recapitulacion.numero_caso_coincide` | JS | clave | Todos los números de caso que el agente comunica son iguales a `metadatos_caso.numero_caso`. | Si el agente no comunica número de caso o `numero_caso` es `null`. |
| `recapitulacion.tipificacion` | HÍBRIDO | clave | **LLM:** `tema` del catálogo con evidencia. **JS:** cumple si existe una fila de `catalogo_temas` con ese `tema` y `tipificacion_valida = tipificacion_agente`. Si no cumple, activa `critico.tipificacion_incorrecta`. | Nunca. |
| `recapitulacion.recordatorio_inactividad` | JS | complementario | Un **silencio del cliente** es el intervalo que empieza en un mensaje del agente `A` y termina en el siguiente mensaje `S` de la conversación, sin mensaje del cliente en medio. Exclusiones:<br>• Intervalos dentro de un episodio de espera: ya los evalúan `retoma_a_tiempo` y `no_excede_espera` (no se castiga dos veces).<br>• Silencios que empiezan en un mensaje del agente que coincide con `despedida` o `cierre_inactividad`. Por ejemplo, un "gracias" tardío después de la despedida o un "ya regresé" después del cierre no se castigan.<br>• Silencios que empiezan en un mensaje del agente que coincide con `recordatorio_inactividad`. Si el cliente responde tarde después del recordatorio, no se castiga: el recordatorio ya se envió. El intervalo entre recordatorio y cierre lo evalúa `recapitulacion.cierre_inactividad`.<br>• El **silencio final** (la conversación termina en un mensaje del agente sin respuesta): no se mide, porque no existe `S` que dé la referencia de tiempo. Para cada silencio mayor que `config.chat_recordatorio_inactividad_seg` (120, SUPUESTO):<br>• Si `S` es del agente, debe coincidir con `recordatorio_inactividad`.<br>• Si `S` es del cliente (el cliente respondió tarde y el agente nunca envió recordatorio) → `no_cumple`.<br>Cumple si todos los silencios mayores al umbral se atendieron con recordatorio. | Si no hay silencios del cliente mayores al umbral. |
| `recapitulacion.cierre_inactividad` | JS | complementario | Si tras el recordatorio el cliente no responde, el agente cierra con `cierre_inactividad` y no antes de `config.chat_cierre_inactividad_seg` (120, SUPUESTO) contados desde el recordatorio. | Si no hubo recordatorio o el cliente respondió después de él. |

### 3.7 Ayuda adicional y encuesta (`ayuda_adicional`, peso 5)

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `ayuda_adicional.ofrece_ayuda_adicional` | JS | clave | Algún mensaje del agente, en la parte final (después de la solución), coincide con `ayuda_adicional`. Se toman los últimos `config.cierre_mensajes_agente` (3, SUPUESTO) mensajes del agente. | Si la conversación termina por inactividad del cliente (ver 3.10). |
| `ayuda_adicional.encuesta` | JS | clave | Algún mensaje del agente coincide con `encuesta`. | Si `estado_caso` no es `cerrado`, o si termina por inactividad del cliente. |
| `ayuda_adicional.canales_horarios` | JS | complementario | Algún mensaje del agente coincide con `canales_horarios`. | Si termina por inactividad del cliente. |
| `ayuda_adicional.campana_vigente` | JS | complementario | Algún mensaje del agente coincide con `campana_vigente`. | Si `config.campana_vigente_activa = no` o si termina por inactividad del cliente. |
| `ayuda_adicional.encuesta_caso_cerrado` | JS | complementario | No se ofrece la encuesta si el caso no está cerrado: `no_cumple` si hay un mensaje `encuesta` y `estado_caso` ≠ `cerrado`. | Si `estado_caso` es `cerrado` (lo cubre `ayuda_adicional.encuesta`), o si termina por inactividad del cliente. |

Con inactividad del cliente, todos los subelementos de esta sección quedan `no_aplica`. La sección queda `no_aplica` y la nota se renormaliza (D5).

### 3.8 Cierre (`cierre`, peso 5)

Se evalúan los últimos `config.cierre_mensajes_agente` (3, SUPUESTO) mensajes del agente.

| ID | Origen | Clase | Regla | `no_aplica` cuando |
|---|---|---|---|---|
| `cierre.agradece` | JS | clave | Coincide con `agradecimiento_cierre`. | Nunca. |
| `cierre.nombre_agente` | JS | complementario | Contiene el nombre de pila de `agente`. | Nunca. |
| `cierre.marca` | JS | complementario | Contiene `config.marca`. | Nunca. |
| `cierre.frase_cortesia` | JS | complementario | Coincide con `frase_cortesia`. | Nunca. |
| `cierre.despedida` | JS | clave | Coincide con `despedida` o con `cierre_inactividad`. | Nunca. |

### 3.9 Justificación de los subelementos clave

| ID | Origen | Justificación |
|---|---|---|
| `apertura.toma_a_tiempo` | JS | No tomar a tiempo es error crítico; la sección no puede quedar parcial si ocurre. |
| `apertura.aviso_privacidad` | JS | Requisito regulatorio de la apertura (protección de datos personales). Es clave **siempre**, aunque la conversación no trate datos de la cuenta (decisión del dueño). |
| `empatia.muestra_empatia` | LLM | Es el núcleo de la sección. |
| `empatia.cordialidad` | LLM | Detecta el caso difícil "resuelve con tono seco". |
| `diagnostico.solicitudes_detectadas` | LLM | Sin detectar la necesidad no hay diagnóstico. |
| `diagnostico.solicitudes_atendidas` | LLM | Detecta el caso difícil "amable que no resuelve". |
| `solucion.informacion_correcta` | LLM | Es el riesgo principal para el cliente. |
| `solucion.apego_proceso` | LLM | El proceso de la base de conocimiento es obligatorio. |
| `solucion.escala_cuando_requiere` | HÍBRIDO | No escalar un caso que lo requiere deja al cliente sin solución. Escalar de más es menos grave, por eso `solucion.no_escala_innecesario` es complementario. |
| `comunicacion.ortografia` | HÍBRIDO | Es el centro de la comunicación escrita y tiene umbral explícito en la rúbrica. |
| `comunicacion.no_excede_espera` | JS | Exceder la espera máxima afecta directamente la experiencia. |
| `recapitulacion.recapitula` | LLM | Decisión de diseño del dueño. |
| `recapitulacion.informa_numero_caso` | JS | Sin número de caso el cliente no puede dar seguimiento. |
| `recapitulacion.numero_caso_coincide` | JS | Un número equivocado hace que se pierda el seguimiento. |
| `recapitulacion.tipificacion` | HÍBRIDO | Si falla, es error crítico; además alimenta los reportes. |
| `ayuda_adicional.ofrece_ayuda_adicional` | JS | Es el propósito de la sección. |
| `ayuda_adicional.encuesta` | JS | Es la medición de la experiencia del cliente. |
| `cierre.agradece` | JS | Elemento mínimo de cortesía del cierre. |
| `cierre.despedida` | JS | Marca el cierre formal y lo distingue de un abandono. |

Resumen: 54 subelementos de sección. Son 19 clave (9 JS, 7 LLM, 3 HÍBRIDO), 34 complementarios y 1 informativo. Todos los clave tienen columna de calificación humana en `revision_humana` (ver `sheets.md`), para medir el acuerdo por origen.

Por origen, los 54 subelementos son 34 JS, 15 LLM y 5 HÍBRIDO.

### 3.10 Inactividad del cliente vs abandono del agente

Son dos situaciones distintas y la rúbrica las trata de forma distinta.

**Definiciones (las calcula JS-1/JS-3 con timestamps y listas):**
- **Termina por inactividad del cliente** (`termina_por_inactividad = true`). Se cumplen las tres condiciones:
  - Hay un mensaje del agente que coincide con `recordatorio_inactividad`.
  - Después de ese recordatorio, el agente envía un mensaje que coincide con `cierre_inactividad`.
  - El cliente no escribe entre el recordatorio y el cierre.

  Que los tiempos se respeten lo evalúan `recapitulacion.recordatorio_inactividad` y `recapitulacion.cierre_inactividad`; no cambia la clasificación.
- **Abandono del agente** (`critico.abandono`). Hay un mensaje del cliente sin respuesta posterior del agente. Ver la regla completa y su excepción en la sección 5.

| Situación | Ejemplo (final de la conversación) | `critico.abandono` | Recapitulación | Ayuda adicional | Cierre |
|---|---|---|---|---|---|
| 1. Inactividad del cliente, atendida en tiempo | [8] agente: "¿Sigues ahí? Quedo atento." (recordatorio, 125 s después del último mensaje del agente) · [9] agente: "Al no recibir respuesta, cierro el chat. Gracias por contactar a Contamix." (130 s después) | no detectado | `recapitula` y `uso_solucion_seguimiento` `no_aplica`; `recordatorio_inactividad` y `cierre_inactividad` `cumple`; número de caso y tipificación se evalúan normal | sección `no_aplica` (se renormaliza) | `despedida` cumple con `cierre_inactividad` |
| 1b. Inactividad del cliente, cierre antes de tiempo | Igual que 1, pero [9] llega 40 s después del recordatorio | no detectado | `cierre_inactividad` `no_cumple` (complementario) | sección `no_aplica` | igual que 1 |
| 2. Abandono del agente | [7] cliente: "¿Y qué hago con la factura duplicada?" · fin de la conversación, sin respuesta del agente | **detectado** (`nota_final = 0`) | se evalúa normal (`recapitula` probablemente `no_cumple`) | se evalúa normal | `despedida` `no_cumple` |
| 3. Cliente escribe después de la despedida (no es abandono) | [10] agente: "Gracias por contactar a Contamix, que tengas buen día." · [11] cliente: "gracias" | no detectado (excepción C) | normal | normal | normal |
| 4. Cliente escribe después del cierre por inactividad (no es abandono) | [9] agente: cierre por inactividad · [10] cliente: "perdón, ya regresé" | no detectado (excepción C) | como en 1 | como en 1 | como en 1 |

Si la conversación termina con un mensaje del agente que no es despedida ni cierre por inactividad (por ejemplo, una pregunta sin respuesta del cliente y sin recordatorio), **no** es `critico.abandono`. Ese silencio final no se mide para `recapitulacion.recordatorio_inactividad`, porque no hay referencia de tiempo. Lo castigan, según corresponda:
- `cierre.despedida` = `no_cumple`, porque los últimos mensajes del agente no traen despedida ni cierre por inactividad;
- `recapitulacion.cierre_inactividad` = `no_cumple` si el agente ya había enviado un recordatorio y nunca cerró (SUPUESTO: solo esta viñeta).

**Coherencia de la regla de silencio con la tabla:**

| Caso | Silencios medidos | `recordatorio_inactividad` | `cierre_inactividad` |
|---|---|---|---|
| 1 | Último mensaje del agente → [8], de 125 s, atendido con recordatorio. [8] → [9] queda excluido porque empieza en el recordatorio; lo evalúa `cierre_inactividad`. | cumple | cumple (130 s ≥ 120) |
| 1b | Igual que 1; [8] → [9] es de 40 s. | cumple | no_cumple |
| 2 | No hay silencio que empiece en el agente sin respuesta: el último mensaje es del cliente. | no_aplica (si no hubo otros silencios) | no_aplica |
| 3 | [10] → [11] queda excluido, porque empieza en una despedida. | no_aplica (si no hubo otros silencios) | no_aplica |
| 4 | [9] → [10] queda excluido, porque empieza en un cierre por inactividad. | como en 1 | como en 1 |
| Final sin despedida | El silencio final no se mide. | según los silencios anteriores | no_cumple solo si hubo recordatorio sin cierre |
| 5. El cliente responde tarde tras el recordatorio | Último mensaje del agente → recordatorio (125 s): atendido. Recordatorio → mensaje del cliente (200 s): excluido. | cumple | no_aplica (el cliente respondió después del recordatorio) |

### 3.11 Casos borde

Todos son SUPUESTO salvo que se indique otra cosa.

| Caso | Tratamiento |
|---|---|
| Todas las secciones quedan `no_aplica` | No se genera evaluación. `log_errores` con `tipo_error = evaluacion_sin_secciones_aplicables`, alerta operativa y conversación en `error` (ver 2.2). |
| Conversación sin mensajes del agente | **Sí se evalúa, solo con JavaScript** (decisión del dueño). Detalle en 3.12. Cuenta en las métricas como cualquier otra evaluación. |
| Episodio de espera que nunca se cierra (no hay mensaje posterior del agente fuera de `pide_espera`/`continua_espera`) | El episodio queda **abierto** y termina en el último mensaje de la conversación. `no_excede_espera` se evalúa con esa duración. `agradece_espera` = `no_cumple`. `retoma_a_tiempo` se evalúa con los intervalos que haya. Si el cliente escribió después sin respuesta, además aplica `critico.abandono`. |
| Plazo de seguimiento en otras unidades | Conversión a horas hábiles:<br>• "N horas" (hábiles o no) = N.<br>• "N días hábiles" = N × `config.horas_habiles_por_dia` (9).<br>• "N días" sin "hábiles" = N × 9 (se trata como días hábiles).<br>• "N semanas" = N × 5 × 9. |
| Duración en minutos ("dame 10 minutos", "en 30 minutos te confirmo") | **No es plazo de seguimiento** (decisión del dueño, Fase 1): se ignora y no cuenta como "último plazo". Vía única: la expresión regular `plazo_seguimiento` de `listas` no reconoce minutos como unidad, así que JS nunca los captura. Si el único "plazo" del agente está en minutos, no hay plazo comunicado y `solucion.seguimiento_en_plazo = no_cumple`. |
| Número escrito con palabras ("dos días hábiles", "cuarenta y ocho horas") | JS reemplaza primero las palabras de `numero_en_palabras` por su cifra (de la frase más larga a la más corta y con límite de palabra, para que "cuarenta y ocho" no se lea como "ocho") y después aplica `plazo_seguimiento`. Un número en palabras que no está en la lista no se reconoce y se trata como plazo sin número. |
| Plazo expresado como rango ("24 a 48 h", "de 2 a 3 días hábiles") | Se usa el extremo **mayor**. |
| Plazo sin número ("en breve", "lo antes posible", "pronto") o con unidad no reconocida | No cuenta como plazo comunicado: `solucion.seguimiento_en_plazo = no_cumple`, con la frase como evidencia. |
| Varios plazos en la conversación | Se evalúa el último plazo que comunica el agente. |

### 3.12 Conversación sin mensajes del agente (evaluación solo con JS)

Decisión del dueño: la conversación se evalúa, no se llama al LLM y cuenta en las métricas. JS marca la evaluación con `sin_mensajes_agente = true` solo para identificarla, no para excluirla. Los detalles marcados SUPUESTO son propuesta de `contrato-datos`.

**Resultados:**
- **Criterios [LLM]:** `no_aplica`, con justificación "sin mensajes del agente: no se llamó al LLM". SUPUESTO.
- **Criterios [HÍBRIDO]:** `no_aplica` con la misma justificación, porque falta el insumo del LLM. Son `solucion.escala_cuando_requiere`, `solucion.no_escala_innecesario`, `comunicacion.ortografia`, `recapitulacion.uso_solucion_seguimiento` y `recapitulacion.tipificacion`. SUPUESTO.
- **Criterios [JS]:** se aplican sus reglas normales sobre un conjunto vacío de mensajes del agente.
  - Los que buscan una acción del agente quedan `no_cumple`: saludo, bienvenida, marca, nombre, ofrecimiento de ayuda, aviso de privacidad, nombre del cliente, `toma_a_tiempo`, `informa_numero_caso` (si hay `numero_caso`), ayuda adicional, encuesta (si el caso está cerrado), canales y horarios, campaña (si está activa) y los 5 de cierre.
  - Los que buscan algo indebido en mensajes del agente quedan `no_aplica`: `mayusculas_sostenidas`, `signos_apertura`, `tecnicismos`, `frases_negativas` y `vicios_lenguaje`. No hay texto que revisar.
  - Los de esperas e inactividad quedan `no_aplica` por sus propias condiciones: no hay episodios, retrasos ni silencios medibles. Lo mismo `numero_preguntas` y `numero_caso_coincide`.
  - Los de metadatos (`campos_obligatorios`, `seguimiento_en_plazo`, `encuesta_caso_cerrado`) se evalúan igual que siempre.
  - `termina_por_inactividad = false`.
- **Identidad:** el bloque queda `no_aplica`, porque no hay solicitud de datos ni información de la cuenta (`info_n` se toma como `null`).
- **Críticos:**
  - Se detectan `critico.no_toma_a_tiempo` y `critico.abandono`. `critico.no_genera_caso` se evalúa con los metadatos, como siempre.
  - Quedan `no_detectado`, sin mensajes del agente donde ocurrir: `palabras_altisonantes`, `validacion_identidad`, `confidencialidad` y los 5 [LLM].
  - `tipificacion_incorrecta` queda `no_detectado` porque no hay tema del LLM con qué comparar (SUPUESTO).
- **Nota:**
  - `nota_base` se calcula con las reglas normales D1 y D5 sobre esos resultados. Las secciones que quedan sin subelementos aplicables (en la práctica `empatia`, `diagnostico` y `comunicacion`) quedan `no_aplica` y se renormaliza. Sale baja, pero puede no ser 0 si algún criterio de metadatos cumple. **En este caso `nota_base` no se interpreta.** Métricas (incluida la diferencia promedio de nota) y tablero usan `nota_final` (0) para estas conversaciones.
  - `nota_final = 0` por los críticos. `calidad = mala`.
- **Consumo y campos del LLM:**
  - `modelo_evaluador = null`, `tema_detectado = null`, `emocion_cliente = null`.
  - `tokens_entrada = 0`, `tokens_salida = 0`, `intentos_llm = 0`, `costo_usd = 0`. El costo es 0 aunque los precios estén en `por_verificar`, porque no hubo llamada.
  - `version_prompt` es el configurado, para conservar la `llave_dedup`.
- **Alertas:** se envía la alerta de calidad de los dos críticos, con el modo del lote. No es un error operativo y no se escribe en `log_errores`.

## 4. Validación de identidad (`identidad`)

No es una sección ponderada. Si falla `identidad.pide_datos` o `identidad.orden_validacion`, o si `identidad.datos_coinciden` falla porque el agente dio información de la cuenta, se activa `critico.validacion_identidad`. El único `no_cumple` que no activa el crítico es el de `identidad.datos_coinciden` cuando el agente no reveló información (ver su regla y la tabla de casos). Se registra en `detalle_criterios` con `tipo_criterio = identidad`.

**Aplicabilidad del bloque:** aplica si el LLM reporta `primer_mensaje_info_cuenta.mensaje_n` distinto de `null` o si algún mensaje del agente coincide con `pide_datos_identidad`. Si no aplica, los tres subelementos quedan `no_aplica`.

Datos comparables (`config.identidad_datos_comparables`, SUPUESTO): `correo`, `rfc`, `telefono`, `titular`.

**Regla de validación (decisión del dueño, Fase 1):**
- La validación es **exitosa** si el cliente acierta al menos `config.identidad_min_datos_correctos` (2) datos comparables distintos, comparados contra la hoja `cuentas`.
- Un dato que el cliente no sabe o no proporciona cuenta como **no acertado**. Un dato incorrecto tampoco cuenta.
- Si el cliente falla o no sabe un dato, el agente puede pedir **datos alternativos** antes de declinar, y esos datos cuentan para el mínimo. Los alternativos válidos son los mismos datos comparables de `config.identidad_datos_comparables`; no hay otros.
- Si no se alcanza el mínimo, el agente debe **declinar** y no dar información de la cuenta. Si la da, aplica `critico.validacion_identidad`.
- **Número de caso (dato alternativo RESERVADO para la Fase 5, inactivo):** hoy no cuenta como dato válido para el mínimo, porque la hoja `cuentas` no tiene casos previos y no está en `config.identidad_datos_comparables`. Pedirlo o recibirlo no es error del agente. La lista `pide_numero_caso` exige verbo de solicitud, con una excepción aprobada (23-oct-2026): las formas elípticas "numero de caso, por favor" y "¿numero de caso?" también coinciden (texto normalizado). Pedirlo no cuenta como solicitud de `identidad.pide_datos` ni para el mínimo de datos; su única consecuencia es que el mensaje del agente que lo pide (coincide con la lista `pide_numero_caso`) cuenta como "sigue pidiendo datos" en `identidad.datos_coinciden`. Fuera de eso no cambia ningún resultado. La regla del mínimo sigue igual: si el agente da información de la cuenta sin que el cliente alcance el mínimo con datos válidos (`correo`, `rfc`, `telefono`, `titular`), aplica `critico.validacion_identidad`. Pendiente registrado en `config.md` sección 13 (Backlog Fase 5).
- Los datos incorrectos no hacen fallar la validación por sí mismos: solo importa si se alcanza el mínimo de acertados. Se registran como evidencia.

**Regla del titular (decisión del dueño):** el nombre del titular solo cuenta como dato acertado cuando coincide con `cuentas.titular` (nombre completo, o nombre de pila + apellido, sin acentos ni mayúsculas). **Nunca cuenta como dato incorrecto.** Limitación: extraer nombres de personas con reglas no es confiable. Si el cliente escribe un nombre que no coincide, JS no puede distinguir si es un nombre equivocado, el de un tercero o una palabra cualquiera; por eso se ignora.

**Variables que calcula JS:**
- `mensaje_solicitud_n`: primer mensaje del agente que coincide con `pide_datos_identidad`; `null` si no hay.
- `datos_proporcionados`: datos comparables que JS-2 extrae de **cualquier mensaje del cliente anterior a `info_n`**, o de todos los mensajes del cliente si `info_n` es `null`. No solo cuentan los posteriores a la solicitud. Así no hay falso positivo cuando el cliente da su RFC en el primer mensaje. Los canales oficiales y los RFC genéricos que escriba el cliente no son datos de identidad y se ignoran.
- `datos_correctos`: número de tipos de dato distintos de `datos_proporcionados` con al menos un valor que coincide con la hoja `cuentas`. Reglas de comparación:
  - correo, sin distinguir mayúsculas;
  - RFC, en mayúsculas;
  - teléfono, solo dígitos;
  - titular, con la regla del titular.

  Un mismo tipo de dato cuenta una sola vez, aunque el cliente lo repita o lo corrija.
- `incorrectos`: valores de correo, RFC o teléfono proporcionados que no coinciden con la cuenta. **Solo evidencia**; no cambia ningún resultado.
- `mensaje_validacion_n`: mensaje del cliente en el que `datos_correctos` alcanza `config.identidad_min_datos_correctos`, acumulando en orden; `null` si nunca se alcanza.
- `validacion_exitosa`: `true` si `mensaje_validacion_n` no es `null` (el cliente acertó el mínimo antes de `info_n`, o en toda la conversación si `info_n` es `null`).
- `declina`: algún mensaje del agente posterior a `mensaje_solicitud_n` coincide con `declina_validacion`.
- `info_n`: `primer_mensaje_info_cuenta.mensaje_n` del LLM. Comunicar el número de caso de la conversación actual NO es información de la cuenta; revelar el contenido de casos anteriores SÍ lo es.

Cambio de Fase 1: `datos_suficientes` (datos **proporcionados** ≥ `identidad_min_datos_solicitados`) y la condición `incorrectos < identidad_umbral_datos_incorrectos` se sustituyeron por `datos_correctos` y `validacion_exitosa`. Ver `config.md`, sección 6.

| ID | Origen | Regla | Evidencia esperada |
|---|---|---|---|
| `identidad.pide_datos` | JS | Cumple si `mensaje_solicitud_n` no es `null`: el agente pide los datos de validación, sin importar si el cliente los da. `no_cumple` si el bloque aplica y el agente nunca los pide. | `mensaje_solicitud_n` y frase detectada. |
| `identidad.datos_coinciden` | JS | Evalúa cómo actúa el agente ante el resultado de la validación, no solo la coincidencia de datos. Si `mensaje_solicitud_n` es `null` (el agente nunca pidió datos) → `no_aplica`; esa falta ya la castigan `identidad.pide_datos` y `critico.validacion_identidad`.<br><br>Si `validacion_exitosa` → cumple.<br><br>Si **no** `validacion_exitosa` (el cliente no acertó el mínimo):<br>• `info_n` no es `null` (da información de la cuenta sin que el cliente alcance el mínimo) → `no_cumple`.<br>• `info_n` es `null` y `declina` → cumple (el agente declinó, como debe).<br>• `info_n` es `null`, sin declinar, y el agente **sigue pidiendo datos** (alternativos o los mismos) → cumple. El agente "sigue pidiendo datos" solo si su último mensaje que no es despedida, `cierre_inactividad` ni `recordatorio_inactividad` coincide con `pide_datos_identidad` o `pide_numero_caso` Y es posterior al último mensaje del cliente que aporta datos de identidad. **"Mensaje del cliente que aporta datos de identidad"** (decisión del dueño, 23-oct-2026): mensaje del cliente en el que JS-2 extrae correo, RFC, teléfono o titular (según `config.identidad_datos_comparables`), sea el dato correcto o no. NO cuentan: los RFC de `rfc_genericos_permitidos`, el RFC del receptor ni otros datos de terceros, los canales oficiales, ni un nombre de pila solo. **Dato de tercero (decisión del dueño, 23-oct-2026):** JS-2 marca un correo, RFC o teléfono del cliente como de tercero cuando su cláusula (delimitada por `.` `?` `!` `;` o salto de línea) coincide con la lista `dato_de_tercero` ("receptor", "cliente final", "de mi cliente", "de mi proveedor", "a quien le facturo"...). **REGLA: un dato que COINCIDE con el de la cuenta NUNCA se marca como de tercero; la lista solo aplica a datos que no coinciden con la cuenta.** Caso obligatorio: "mi RFC es <RFC de la cuenta>, con él le facturo a mi cliente" → dato correcto (cuenta como dato de identidad aportado, aunque diga "mi cliente"). Caso contrario: "el RFC del receptor es <otro RFC>" → de tercero, no cuenta. Si el cliente abandona tras la solicitud (no vuelve a responder y hay cierre por inactividad), no es falla del agente: sigue pidiendo → cumple.<br>• `info_n` es `null`, sin declinar y sin seguir pidiendo datos (cambia de tema, da largas o cierra sin declinar, incluso si el cliente respondió con datos insuficientes) → `no_cumple`, **sin crítico**: no reveló información. | Datos comparados (enmascarados), `datos_correctos`, `incorrectos` (evidencia), `mensaje_validacion_n`, y el mensaje de declinación o el que sigue pidiendo datos; si falla por no declinar, el último mensaje del agente sobre el tema, o la marca "ausente". |
| `identidad.orden_validacion` | HÍBRIDO | **LLM:** aporta `info_n`. **JS:** cumple si `info_n` es `null`, o si `validacion_exitosa` y `info_n > mensaje_validacion_n`. En cualquier otro caso → `no_cumple`: información antes de la validación, sin validación o sin que el cliente alcance el mínimo de datos acertados. | `info_n`, `mensaje_validacion_n`, `validacion_exitosa`. |

**Cómo queda cada caso** (con `identidad_min_datos_correctos = 2`):

| Caso | `pide_datos` | `datos_coinciden` | `orden_validacion` | `critico.validacion_identidad` |
|---|---|---|---|---|
| Pide, el cliente da 2 datos correctos y luego recibe información | cumple | cumple | cumple | no detectado |
| Pide 3 datos, el cliente acierta 2 de 3 (el tercero es incorrecto) y luego recibe información: **exitosa** | cumple | cumple | cumple | no detectado |
| Pide 3 datos, el cliente acierta 1 y dice que no sabe los otros 2: **no alcanza el mínimo**; el agente declina y no da información | cumple | cumple | cumple | no detectado |
| Igual que el anterior (1 correcto y 2 que no sabe), pero el agente da información de la cuenta | cumple | no_cumple | no_cumple | detectado |
| Pide 2 datos, el cliente acierta 1 y falla 1; el agente pide un dato alternativo, el cliente lo acierta y luego recibe información: **exitosa** (2 acertados) | cumple | cumple | cumple | no detectado |
| El cliente da su RFC en el primer mensaje, el agente pide datos, el cliente da su correo y luego recibe información | cumple | cumple (2 acertados: RFC del mensaje 1 + correo) | cumple | no detectado |
| El cliente da RFC y correo correctos en el primer mensaje, el agente nunca los pide y da información | no_cumple | no_aplica | cumple (`info_n` > `mensaje_validacion_n`) | detectado (por `pide_datos`) |
| Pide, el cliente falla o no sabe los datos (menos de 2 acertados), el agente declina y no da información | cumple | cumple | cumple | no detectado |
| Pide, el cliente no alcanza 2 acertados y el agente da información | cumple | no_cumple | no_cumple | detectado |
| Pide, el cliente no alcanza el mínimo, el agente no da información y sigue pidiendo datos (alternativos o los mismos) | cumple | cumple | cumple | no detectado |
| Pide, el cliente no alcanza el mínimo, el agente no da información, no declina y cambia de tema o da largas | cumple | **no_cumple** | cumple | **no detectado** |
| Pide, el cliente responde con datos insuficientes (no alcanza el mínimo), el agente no da información y solo se despide, sin declinar ("cierra sin declinar") | cumple | **no_cumple** | cumple | **no detectado** |
| Pide datos y el cliente abandona (no vuelve a responder; el agente recuerda y cierra por inactividad) | cumple | cumple (sigue pidiendo; no es falla del agente) | cumple | no detectado |
| Pide datos, pero da información antes de que el cliente complete la validación (validación fuera de orden) | cumple | según los datos anteriores a `info_n` (si antes de `info_n` no se alcanzó el mínimo, no_cumple) | no_cumple | detectado |
| No pide datos y da información de la cuenta | no_cumple | no_aplica | no_cumple | detectado |
| No pide datos y no da información de la cuenta | bloque `no_aplica` | no_aplica | no_aplica | no detectado |

La validación fuera de orden queda definida igual que antes: `orden_validacion = no_cumple` cuando `info_n ≤ mensaje_validacion_n` o cuando no hay validación exitosa antes de `info_n`.

## 5. Errores críticos

Si alguno queda `detectado`, `nota_final = 0` (D2).

Regla general para los de origen LLM: JS acepta un crítico del LLM solo si viene con `detectado = true`, al menos un número de mensaje válido que sea del agente y justificación no vacía. Si no se cumple, JS-5 rechaza la respuesta.

| ID | Origen | Regla | Evidencia esperada |
|---|---|---|---|
| `critico.no_toma_a_tiempo` | JS | `apertura.toma_a_tiempo = no_cumple`. | Mensajes 1.º del cliente y 1.º del agente, segundos transcurridos y umbral. Alternativa: "sin mensajes del agente" (3.12), con el número del primer mensaje del cliente. |
| `critico.no_genera_caso` | JS | `metadatos_caso.numero_caso` es `null`. | Valor de `numero_caso`. |
| `critico.abandono` | JS | Sea `u` el último mensaje del cliente. Detectado si no hay ningún mensaje del agente posterior a `u`. **Excepción:** no es abandono si, antes de `u`, el agente ya envió un mensaje que coincide con `despedida` o con `cierre_inactividad` (por ejemplo, el cliente escribe "gracias" después de la despedida). La inactividad del cliente atendida con recordatorio y cierre no es abandono (ver 3.10). | Número y hora de `u`, y ausencia de despedida o cierre previos. |
| `critico.palabras_altisonantes` | JS | Algún mensaje del agente contiene un término de `palabra_altisonante`. | Mensaje y término detectado. |
| `critico.validacion_identidad` | HÍBRIDO | Algún subelemento de `identidad` es `no_cumple` (sección 4): el agente no pide datos y da información de la cuenta, da información antes de que el cliente acierte `config.identidad_min_datos_correctos` datos, o la da sin que el cliente alcance ese mínimo en lugar de declinar. No se activa si el agente no reveló información, aunque `identidad.datos_coinciden` sea `no_cumple` por no declinar (sección 4). **LLM:** aporta `primer_mensaje_info_cuenta`. **JS:** decide. | Subelementos fallidos y sus evidencias. |
| `critico.confidencialidad` | HÍBRIDO | **JS:** detectado si algún mensaje del agente contiene un correo, RFC o teléfono **completo** (detectado antes de enmascarar) que cumple las tres condiciones siguientes:<br>• el cliente no lo escribió antes en la conversación;<br>• no está en los canales oficiales (`config.canales_oficiales_correos`, `config.canales_oficiales_telefonos`) ni es un RFC genérico (`config.rfc_genericos_permitidos`);<br>• no va enmascarado parcialmente según `config`.<br><br>**Enmascarado parcial aceptado (SUPUESTO).** Tras una validación exitosa, el agente puede mencionar el correo o el teléfono registrados de la cuenta solo así:<br>• correo: `config.enmascarado_correo_visibles_inicio` (1) caracteres visibles al inicio de la parte local, el resto con `*` y el dominio completo, como `j***@abarrotesluna.example`;<br>• teléfono: solo los últimos `config.enmascarado_telefono_visibles_final` (4) dígitos visibles, como `******5678`;<br>• RFC: solo los últimos `config.enmascarado_rfc_visibles_final` (3) caracteres visibles, como `**********AB3`.<br><br>**Detección (SUPUESTO).** JS-2 detecta en los mensajes del agente, antes de enmascarar, tokens que contienen `config.enmascarado_caracter` (`*`) con estas formas:<br>• correo parcial: parte local con al menos un `*`, seguida de `@dominio`;<br>• teléfono parcial: 10 posiciones de dígitos o `*` (con espacios o guiones opcionales) y al menos un `*`;<br>• RFC parcial: 12 o 13 posiciones de `[A-ZÑ&0-9*]` con al menos un `*`.<br><br>**Relación con la cuenta.** Un dato (completo o parcial) es un *dato registrado* si corresponde al correo, teléfono o RFC de `cuentas`. En los parciales, cada carácter visible debe coincidir con el dato registrado en la misma posición, y en el correo el dominio debe ser igual. Los caracteres visibles son los que no son `*` (en el correo, solo se cuentan los de la parte local). Los parciales que no corresponden a la cuenta se ignoran.<br><br>**Regla.** Cuenta como revelación toda mención del agente de un dato registrado que el cliente no escribió completo antes en la conversación, y también un dato completo de un tercero:<br>• Antes de una validación exitosa (`validacion_exitosa` falsa, o mensaje anterior o igual a `mensaje_validacion_n`): cualquier mención, completa o parcial, es revelación.<br>• Después de una validación exitosa: solo se permite la versión parcial, con caracteres visibles ≤ los configurados y en la posición configurada (inicio del correo; final del teléfono y del RFC). Completo, o con más caracteres visibles, es revelación.<br>• Los canales oficiales y los RFC genéricos (`config.rfc_genericos_permitidos`) nunca cuentan.<br><br>Las conversaciones `buenas` del lote deben respetar este formato.<br><br>**LLM:** `criticos_posibles.confidencialidad` (revela información confidencial de la cuenta, de terceros o interna).<br><br>**JS (decisión final):** detectado si cualquiera de las dos partes lo indica con evidencia válida. | Mensaje y tipo de dato (marcador), o mensaje y justificación del LLM. |
| `critico.tipificacion_incorrecta` | HÍBRIDO | `recapitulacion.tipificacion = no_cumple`. **LLM:** aporta `tema`. **JS:** compara contra catálogo. | `tipificacion_agente`, `tema` del LLM y tipificaciones válidas. |
| `critico.informacion_incorrecta` | LLM | Información incorrecta respecto a la base de conocimiento **con impacto** para el cliente. Hay impacto (SUPUESTO) si seguir la información puede causar: pérdida o cobro de dinero; incumplimiento de un plazo legal o fiscal (por ejemplo, de cancelación de CFDI); sanción o multa del SAT; pérdida o corrupción de datos; acceso indebido a la cuenta. La información incorrecta sin esas consecuencias solo afecta `solucion.informacion_correcta`. | Mensaje, artículo y justificación. |
| `critico.promesa_no_autorizada` | LLM | Promete algo que la base no autoriza (descuentos, reembolsos, plazos o promociones no vigentes). | Mensaje, artículo y justificación. |
| `critico.negacion_servicio` | LLM | Se niega a atender una solicitud que sí corresponde al soporte. | Mensaje y justificación. |
| `critico.mala_actitud` | LLM | Sarcasmo, burla, culpar al cliente o trato despectivo. | Mensaje y justificación. |
| `critico.comentarios_negativos_marca` | LLM | Comentarios negativos del agente sobre `config.marca`, sus productos o la empresa. | Mensaje y justificación. |

## 6. Qué recibe y qué devuelve el LLM

- **Recibe:**
  - Conversación enmascarada con mensajes numerados.
  - Criterios [LLM] e insumos [HÍBRIDO] con su descripción.
  - Toda la base de conocimiento en una sola llamada.
  - Catálogo de temas.
- **Devuelve:** solo lo definido en `llm_output.schema.json`. Nunca nota, ponderación, resultado de sección ni decisión final de un híbrido.

Correspondencia entre la salida del LLM y la rúbrica:

| Salida del LLM | Usado por |
|---|---|
| `tema` | `recapitulacion.tipificacion`, `critico.tipificacion_incorrecta`, cálculo de `requiere` (escalamiento) |
| `emocion_cliente` | `empatia.identifica_emocion` (evidencia), `evaluaciones.emocion_cliente` |
| `criterios.<seccion>.<subelemento>` | Los 15 subelementos [LLM] de las secciones 3.2 a 3.6 (empatia 5, diagnostico 3, solucion 4, comunicacion 2, recapitulacion 1) |
| `insumos_hibridos.situacion_escalamiento` | `solucion.escala_cuando_requiere`, `solucion.no_escala_innecesario` (vía `requiere`) |
| `insumos_hibridos.uso_solucion_seguimiento.uso_correcto` | `recapitulacion.uso_solucion_seguimiento` (decisión combinada con JS) |
| `insumos_hibridos.uso_solucion_seguimiento.problema_resuelto_en_conversacion` | Solo evidencia. Se guarda en la justificación de `recapitulacion.uso_solucion_seguimiento` y permite revisar después si `estado_caso` (dato del agente) contradice lo que pasó. No cambia ningún resultado en v1. |
| `errores_ortografia` | `comunicacion.ortografia` |
| `primer_mensaje_info_cuenta` | `identidad.orden_validacion`, `identidad.datos_coinciden`, aplicabilidad del bloque `identidad` |
| `solicitudes_cliente[].detectada_por_agente` | Coherencia de `diagnostico.solicitudes_detectadas` (JS-5) |
| `solicitudes_cliente[].atendida` | Coherencia de `diagnostico.solicitudes_atendidas` (JS-5) |
| `solicitudes_cliente[].mensajes_atencion` | Límite de conteo de `diagnostico.numero_preguntas` (mínimo de todos) y evidencia |
| `articulos_base_usados` | `solucion.informacion_correcta` y `solucion.informacion_completa` (evidencia) |
| `criticos_posibles` | Los 5 críticos [LLM] y la parte LLM de `critico.confidencialidad` |

### 6.1 Reglas de coherencia de JS-5

JS-5 rechaza la respuesta del LLM y la reenvía con el error explicado (máximo `config.reintentos_validacion_llm`) si no se cumple alguna de estas reglas:

1. **Estructura:** cumple `llm_output.schema.json`. `tema.valor` existe en `catalogo_temas` (filas activas del `tipo_interaccion` de la conversación **unidas** a las de `todos`). Cada `id_articulo` existe en `base_conocimiento` (mismo criterio: tipo ∪ `todos`).
2. **Números de mensaje:** todos existen en la conversación. En `errores_ortografia`, `criticos_posibles`, `mensajes_atencion` y `primer_mensaje_info_cuenta` deben ser mensajes del agente; `solicitudes_cliente[].mensaje_n` debe ser del cliente.
3. **`no_aplica` prohibido:** se rechaza en los criterios cuya columna "`no_aplica` cuando" dice "Nunca" (`empatia.cordialidad`, `empatia.lenguaje_acorde`, `diagnostico.solicitudes_detectadas`, `diagnostico.solicitudes_atendidas`, `solucion.informacion_correcta`, `solucion.informacion_completa`, `solucion.apego_proceso`, `comunicacion.redaccion`, `comunicacion.congruencia`).
4. **Emoción neutral:** `no_aplica` en `empatia.identifica_emocion` o `empatia.muestra_empatia` solo con `emocion_cliente.emocion = neutral`.
5. **Recapitulación:** `no_aplica` en `recapitulacion.recapitula` se rechaza si `termina_por_inactividad = false`. Si es `true`, JS impone `no_aplica` después (JS-6/JS-7).
6. **Solicitudes detectadas:** `diagnostico.solicitudes_detectadas = cumple` si y solo si todas las `solicitudes_cliente` tienen `detectada_por_agente = true`.
7. **Solicitudes atendidas:** `diagnostico.solicitudes_atendidas = cumple` si y solo si todas tienen `atendida = true`.
8. **Atención con evidencia:** `atendida = true` exige `mensajes_atencion` no vacío; `atendida = false` exige `mensajes_atencion` vacío.
9. **Evidencia de criterios:** un resultado distinto de `no_aplica` exige `mensajes` no vacío y `justificacion` no vacía.
10. **Evidencia de críticos:** un crítico con `detectado = true` exige al menos un mensaje del agente y justificación no vacía; con `detectado = false`, `mensajes` vacío.

## 7. Notas de diseño

- **D3 (base de conocimiento):** en v1 el LLM recibe toda la base de conocimiento en una sola llamada junto con la evaluación. Separar la clasificación del tema y la evaluación en dos llamadas queda como **hipótesis para v2**, a validar con las métricas de calibración (acuerdo en `recapitulacion.tipificacion` y costo por evaluación).
- Los subelementos [LLM] no se convierten a [JS] aunque se puedan aproximar con frases; si una regla resulta verificable con listas o timestamps, se propone moverla a JS en una versión nueva de reglas (`version_reglas`).
