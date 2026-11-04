# Guía de calificación humana (hoja `revision_humana`)

Guía para la Fase 3. La calificación es **a ciegas** y solo la haces tú. Ningún agente ni workflow la genera, la sugiere o la completa.

Fuentes de esta guía: `contrato/rubrica.md`, `contrato/sheets.md` y `contrato/glosario.md`. Si algo aquí difiere del contrato, manda el contrato.

> **Recordatorio de ceguera.** No abras las hojas `evaluaciones` ni `escenarios` (ni sus archivos) hasta terminar de calificar todo el lote. Tampoco compares tus notas con las del sistema mientras calificas.

---

## 1. Cómo se califica y dónde

Se califica en la hoja `revision_humana` del libro de Google Sheets. Cada fila es una conversación. Lees `texto_legible` (una línea por mensaje: `[n] HH:MM:SS emisor: texto`) y `metadatos_caso_legible`, y llenas tus columnas.

La hoja tiene **52 columnas** en este orden fijo:

| Posición | Letra | Columna(s) | ¿La llenas tú? |
|---|---|---|---|
| 1 | A | `conversation_id` | No (contexto) |
| 2 | B | `lote` | No (contexto) |
| 3 | C | `tipo_interaccion` | No (contexto) |
| 4 | D | `agente` | No (contexto) |
| 5 | E | `cuenta_id` | No (contexto) |
| 6 | F | `metadatos_caso_legible` | No (contexto) |
| 7 | G | `texto_legible` | No (contexto) |
| 8 | H | `estado_revision` | **Sí, solo para cambiar de `pendiente` a `calificada`** al terminar la fila |
| 9 a 16 | I a P | `h_seccion__apertura`, `h_seccion__empatia`, `h_seccion__diagnostico`, `h_seccion__solucion`, `h_seccion__comunicacion`, `h_seccion__recapitulacion`, `h_seccion__ayuda_adicional`, `h_seccion__cierre` | **Sí** |
| 17 a 35 | Q a AI | 19 columnas `h_<seccion>__<subelemento>` de los subelementos clave (ver sección 2) | **Sí** |
| 36 a 38 | AJ a AL | `h_identidad__pide_datos`, `h_identidad__datos_coinciden`, `h_identidad__orden_validacion` | **Sí** |
| 39 a 50 | AM a AX | 12 columnas `h_critico__*` (ver sección 5) | **Sí** |
| 51 | AY | `comentarios_humano` | **Sí** (obligatorio en ciertos casos, ver secciones 3 y 5) |
| 52 | AZ | `calificado_en` | **Sí** (fecha y hora en que terminas la fila) |

Resumen de lo que llenas por fila: 8 secciones + 19 subelementos clave + 3 de identidad + 12 críticos (42 columnas `h_*`), más `comentarios_humano`, `calificado_en` y `estado_revision = calificada`.

Una fila se califica completa: llena **todas** las columnas `h_*`, usando `no_aplica` donde corresponda. No dejes celdas vacías en una fila marcada `calificada`.

### Valores permitidos por tipo de columna

| Columnas | Valores permitidos |
|---|---|
| `h_seccion__*` (posiciones 9 a 16) | `cumple`, `parcial`, `no_cumple`, `no_aplica` |
| Subelementos clave (posiciones 17 a 35) y `h_identidad__*` (36 a 38) | `cumple`, `no_cumple`, `no_aplica` (nunca `parcial`) |
| `h_critico__*` (posiciones 39 a 50) | `si`, `no` |
| `estado_revision` | `pendiente`, `calificada` |

Escribe los valores exactamente así, en minúsculas y con guion bajo (`no_cumple`, no "No cumple").

---

## 2. Las 8 secciones y todos sus subelementos

Cómo leer las tablas:

- **Origen** (`JS`, `LLM`, `HÍBRIDO`) es cómo lo evalúa el sistema. A ti no te cambia nada: tú juzgas la conversación con tu criterio. El origen sirve para medir después el acuerdo por tipo de regla.
- **Clase:** `clave` (si falla, la sección normalmente falla), `complementario` (si falla, la sección normalmente baja a parcial) o `informativo` (no entra en la sección).
- Solo los subelementos **clave** tienen columna `h_*`. Los demás no tienen columna y los consideras al calificar la sección.
- `no_aplica` significa que el subelemento no tiene sentido en esa conversación (la situación no se dio).
- Los subelementos de tipo [JS] suelen medirse con listas de frases o tiempos. Tú los juzgas leyendo la conversación: ¿el agente hizo lo que el subelemento pide?
- Las "esperas" y los tiempos se miden con las horas de `texto_legible`.

Total de subelementos de sección: **54** (19 clave, 34 complementarios, 1 informativo).

### 2.1 Apertura (peso 5) — columna `h_seccion__apertura`

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `apertura.saludo` | JS | complementario | Cumple: el primer mensaje del agente saluda. No cumple: no saluda. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `apertura.bienvenida` | JS | complementario | Cumple: en sus primeros mensajes da la bienvenida. No cumple: no la da. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `apertura.marca` | JS | complementario | Cumple: en sus primeros mensajes nombra la marca (Contamix). No cumple: no la nombra. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `apertura.nombre_agente` | JS | complementario | Cumple: en sus primeros mensajes dice su nombre. No cumple: no lo dice. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `apertura.ofrece_ayuda` | JS | complementario | Cumple: en sus primeros mensajes ofrece ayuda o confirma la solicitud. No cumple: no lo hace. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `apertura.aviso_privacidad` | JS | **clave** | Cumple: el agente da el aviso de privacidad antes de pedir datos de identidad o, si no los pide, en sus primeros mensajes. No cumple: no lo da. No aplica: nunca (siempre se exige, aunque no se hable de datos de la cuenta). | `h_apertura__aviso_privacidad` |
| `apertura.nombre_cliente` | JS | complementario | Cumple: el agente pide el nombre del cliente o lo usa en sus primeros mensajes. No cumple: no. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `apertura.toma_a_tiempo` | JS | **clave** | Cumple: el agente contesta el primer mensaje del cliente dentro del tiempo permitido (`chat_primera_respuesta_seg` = **60 segundos** por defecto en `contrato/config.md`; si cambiaste el valor en tu hoja `config`, usa el tuyo). No cumple: tarda más, o nunca responde. No aplica: el primer mensaje de la conversación es del agente (contacto saliente), salvo que el agente nunca escriba (entonces es no_cumple). | `h_apertura__toma_a_tiempo` |

### 2.2 Empatía y manejo de emociones (peso 10) — columna `h_seccion__empatia`

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `empatia.identifica_emocion` | LLM | complementario | Cumple: el agente reconoce la emoción del cliente. No cumple: no la reconoce. No aplica: el cliente es neutral y no hay señal emocional. | sin columna: se considera al calificar la sección |
| `empatia.muestra_empatia` | LLM | **clave** | Cumple: valida la situación del cliente con frases empáticas pertinentes, no genéricas. No cumple: no lo hace o solo usa frases de relleno. No aplica: el cliente es neutral y no hay situación que validar. | `h_empatia__muestra_empatia` |
| `empatia.cordialidad` | LLM | **clave** | Cumple: trato amable y respetuoso en toda la conversación. No cumple: tono seco, cortante o descortés en algún tramo. No aplica: nunca. | `h_empatia__cordialidad` |
| `empatia.lenguaje_acorde` | LLM | complementario | Cumple: el registro es adecuado al cliente (formalidad, sin tecnicismos innecesarios). No cumple: no lo es. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `empatia.asertividad` | LLM | complementario | Cumple: comunica límites y negativas con claridad y respeto. No cumple: no. No aplica: no hubo nada que negar o limitar. | sin columna: se considera al calificar la sección |
| `empatia.mayusculas_sostenidas` | JS | complementario | Cumple: el agente no escribe en mayúsculas sostenidas (tres o más palabras seguidas largas en mayúsculas; las siglas permitidas no cuentan). No cumple: sí lo hace. No aplica: nunca. | sin columna: se considera al calificar la sección |

### 2.3 Diagnóstico de la necesidad (peso 15) — columna `h_seccion__diagnostico`

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `diagnostico.preguntas_necesarias` | LLM | complementario | Cumple: el agente hace las preguntas necesarias para entender el caso. No cumple: no las hace o le faltan. No aplica: la solicitud llegó completa y no requería preguntas. | sin columna: se considera al calificar la sección |
| `diagnostico.solicitudes_detectadas` | LLM | **clave** | Cumple: el agente reconoce todas las solicitudes del cliente. No cumple: se le pasa alguna. No aplica: nunca. | `h_diagnostico__solicitudes_detectadas` |
| `diagnostico.solicitudes_atendidas` | LLM | **clave** | Cumple: el agente atiende todas las solicitudes del cliente. No cumple: alguna queda sin atender. No aplica: nunca. | `h_diagnostico__solicitudes_atendidas` |
| `diagnostico.numero_preguntas` | JS | informativo | Solo se registra (cuántas preguntas hizo el agente antes de atender). No entra en la sección. | sin columna: informativo, no se califica |

### 2.4 Solución y exactitud (peso 35) — columna `h_seccion__solucion`

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `solucion.informacion_correcta` | LLM | **clave** | Cumple: la información que da coincide con la base de conocimiento. No cumple: da información incorrecta. No aplica: nunca. | `h_solucion__informacion_correcta` |
| `solucion.informacion_completa` | LLM | complementario | Cumple: no omite pasos, requisitos, plazos o condiciones relevantes. No cumple: omite algo relevante. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `solucion.apego_proceso` | LLM | **clave** | Cumple: sigue el proceso definido en la base (orden de pasos, políticas). No cumple: se salta o cambia el proceso. No aplica: nunca. | `h_solucion__apego_proceso` |
| `solucion.ofrece_alternativas` | LLM | complementario | Cumple: ofrece alternativas cuando la solución principal no es posible. No cumple: no las ofrece. No aplica: la solución principal sí se pudo dar. | sin columna: se considera al calificar la sección |
| `solucion.escala_cuando_requiere` | HÍBRIDO | **clave** | Cumple: el caso requería escalarse y el agente lo escaló. No cumple: requería escalarse y no se escaló. No aplica: el caso no requería escalamiento. | `h_solucion__escala_cuando_requiere` |
| `solucion.no_escala_innecesario` | HÍBRIDO | complementario | Cumple: el agente resolvió lo que el soporte debía resolver. No cumple: escaló algo que debía resolver él. No aplica: el caso sí requería escalamiento. (Exactamente uno de los dos subelementos de escalamiento aplica.) | sin columna: se considera al calificar la sección |
| `solucion.campos_obligatorios` | JS | complementario | Cumple: los campos que exige la tipificación quedaron capturados (`metadatos_caso_legible`). No cumple: falta alguno. No aplica: la tipificación no existe en el catálogo o no tiene campos obligatorios. | sin columna: se considera al calificar la sección |
| `solucion.seguimiento_en_plazo` | JS | complementario | Cumple: si el caso no queda cerrado, el agente comunica un plazo de seguimiento de hasta 48 horas hábiles (valor SUPUESTO en `config`). No cumple: no comunica plazo, es vago ("en breve") o excede el límite. Los minutos no cuentan como plazo de seguimiento. No aplica: el caso queda cerrado o sin caso. | sin columna: se considera al calificar la sección |

### 2.5 Comunicación escrita (peso 13) — columna `h_seccion__comunicacion`

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `comunicacion.ortografia` | HÍBRIDO | **clave** | Cumple: pocos errores de ortografía del agente. No cumple: al menos 1 error grave (cambia el sentido, como `si`/`sí`, `haber`/`a ver`) o 3 o más menores (acento omitido, error de dedo). Solo cuentan mensajes del agente. No aplica: nunca. | `h_comunicacion__ortografia` |
| `comunicacion.signos_apertura` | JS | complementario | Cumple: usa `¿` y `¡` de apertura. No cumple: omite alguno. No aplica: el agente no hace preguntas ni exclamaciones. | sin columna: se considera al calificar la sección |
| `comunicacion.tecnicismos` | JS | complementario | Cumple: no usa tecnicismos ni nombres de sistemas internos. No cumple: los usa. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `comunicacion.frases_negativas` | JS | complementario | Cumple: no usa frases negativas ("no se puede", "no es posible", etc.). No cumple: las usa. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `comunicacion.vicios_lenguaje` | JS | complementario | Cumple: sin muletillas ni vicios de lenguaje. No cumple: los usa. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `comunicacion.redaccion` | LLM | complementario | Cumple: redacción clara, ordenada y comprensible. No cumple: confusa o desordenada. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `comunicacion.congruencia` | LLM | complementario | Cumple: los mensajes son coherentes entre sí y con lo que pregunta el cliente. No cumple: se contradice o responde otra cosa. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `comunicacion.pide_espera` | JS | complementario | Cumple: toda espera se anuncia (el agente avisa que necesita tiempo; si no avisa, no hay retraso largo sin respuesta). No cumple: hay un retraso de más de 60 s (SUPUESTO) sin avisar. No aplica: no hubo esperas ni retrasos. | sin columna: se considera al calificar la sección |
| `comunicacion.agradece_espera` | JS | complementario | Cumple: al terminar cada espera, el agente agradece. No cumple: no agradece. No aplica: no hubo esperas. | sin columna: se considera al calificar la sección |
| `comunicacion.retoma_a_tiempo` | JS | complementario | Cumple: durante una espera, el agente no deja pasar más de 120 s (SUPUESTO) entre mensajes. No cumple: lo deja pasar. No aplica: no hubo esperas. | sin columna: se considera al calificar la sección |
| `comunicacion.no_excede_espera` | JS | **clave** | Cumple: ninguna espera dura más de 300 s (SUPUESTO). No cumple: alguna dura más (si una espera nunca se cierra, cuenta hasta el último mensaje). No aplica: no hubo esperas. | `h_comunicacion__no_excede_espera` |

### 2.6 Recapitulación y registro (peso 12) — columna `h_seccion__recapitulacion`

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `recapitulacion.recapitula` | LLM | **clave** | Cumple: antes de cerrar, el agente resume la solicitud y la solución o el siguiente paso. No cumple: no resume. No aplica: la conversación termina por inactividad del cliente (ver sección 4 de esta guía, "Inactividad"). | `h_recapitulacion__recapitula` |
| `recapitulacion.uso_solucion_seguimiento` | HÍBRIDO | complementario | Cumple: usa la palabra correcta según lo que pasó: "solución" si el caso quedó cerrado; "seguimiento" si queda abierto o en seguimiento. No cumple: usa la contraria o ninguna. No aplica: no hay caso, o la conversación termina por inactividad del cliente. | sin columna: se considera al calificar la sección |
| `recapitulacion.informa_numero_caso` | JS | **clave** | Cumple: el agente comunica el número de caso (formato `CASO-` más 5 dígitos). No cumple: no lo comunica. No aplica: no existe número de caso (eso lo cubre el crítico `no_genera_caso`). | `h_recapitulacion__informa_numero_caso` |
| `recapitulacion.numero_caso_coincide` | JS | **clave** | Cumple: todos los números de caso que dice el agente son iguales al registrado en `metadatos_caso_legible`. No cumple: dice uno distinto. No aplica: el agente no comunica número o no hay número de caso. | `h_recapitulacion__numero_caso_coincide` |
| `recapitulacion.tipificacion` | HÍBRIDO | **clave** | Cumple: la tipificación que el agente registró corresponde al tema real de la conversación. No cumple: es de otra categoría. No aplica: nunca. | `h_recapitulacion__tipificacion` |
| `recapitulacion.recordatorio_inactividad` | JS | complementario | Cumple: cada vez que el cliente deja de contestar más de 120 s (SUPUESTO), el agente le envía un recordatorio. No cumple: el cliente tarda y el agente nunca le recuerda. No aplica: no hubo silencios largos del cliente. No se castigan los silencios dentro de una espera, tras la despedida o tras el recordatorio, ni el silencio final. | sin columna: se considera al calificar la sección |
| `recapitulacion.cierre_inactividad` | JS | complementario | Cumple: tras el recordatorio, si el cliente no responde, el agente cierra con aviso de cierre por inactividad y no antes de 120 s (SUPUESTO) desde el recordatorio. No cumple: cierra antes de tiempo, o nunca cierra tras el recordatorio. No aplica: no hubo recordatorio o el cliente respondió después. | sin columna: se considera al calificar la sección |

**Cuando la conversación no genera caso** (`metadatos_caso_legible` muestra `numero_caso: sin caso`; para la rúbrica, el estado del caso es `sin_caso`). Fuente: `rubrica.md` secciones 3.6, 3.7, 3.4 y 8.

| Qué calificar | Cómo queda |
|---|---|
| `h_critico__no_genera_caso` | `si`: el crítico existe justamente porque falta el número de caso (y lleva comentario en `comentarios_humano`). |
| `h_recapitulacion__informa_numero_caso` | `no_aplica`. No se castiga dos veces: ya lo cubre el crítico. |
| `h_recapitulacion__numero_caso_coincide` | `no_aplica`: no hay número registrado con qué comparar. |
| `recapitulacion.uso_solucion_seguimiento` (sin columna) | `no_aplica` cuando no hay caso. |
| `solucion.seguimiento_en_plazo` (sin columna) | `no_aplica` cuando el estado es `sin_caso` o `cerrado`. |
| `h_ayuda_adicional__encuesta` | `no_aplica` cuando el caso no está cerrado, y `sin_caso` no lo está. |
| `ayuda_adicional.encuesta_caso_cerrado` (sin columna) | **Sigue aplicando** con `sin_caso`: falla si el agente ofrece la encuesta aunque el caso no esté cerrado. |

Si el agente sí comunica un número de caso aunque `metadatos_caso_legible` diga `sin caso`, lo que cuenta es el número registrado: sin número registrado, `numero_caso_coincide` es `no_aplica`. Que `sin caso` implique el estado `sin_caso` es un SUPUESTO del glosario.

### 2.7 Ayuda adicional y encuesta (peso 5) — columna `h_seccion__ayuda_adicional`

Si la conversación termina por inactividad del cliente (ver sección 4), todos estos subelementos son `no_aplica` y la sección completa es `no_aplica`.

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `ayuda_adicional.ofrece_ayuda_adicional` | JS | **clave** | Cumple: hacia el final, tras la solución, el agente pregunta si necesita algo más. No cumple: no lo hace. No aplica: termina por inactividad del cliente. | `h_ayuda_adicional__ofrece_ayuda_adicional` |
| `ayuda_adicional.encuesta` | JS | **clave** | Cumple: el agente ofrece la encuesta. No cumple: no la ofrece. No aplica: el caso no quedó cerrado o termina por inactividad del cliente. | `h_ayuda_adicional__encuesta` |
| `ayuda_adicional.canales_horarios` | JS | complementario | Cumple: el agente informa canales y horarios de atención. No cumple: no los informa. No aplica: termina por inactividad. | sin columna: se considera al calificar la sección |
| `ayuda_adicional.campana_vigente` | JS | complementario | Cumple: menciona la campaña vigente. No cumple: no la menciona. No aplica: no hay campaña activa (`campana_vigente_activa = no`) o termina por inactividad. | sin columna: se considera al calificar la sección |
| `ayuda_adicional.encuesta_caso_cerrado` | JS | complementario | Cumple: no ofrece la encuesta cuando el caso no está cerrado. No cumple: la ofrece con el caso sin cerrar. No aplica: el caso sí está cerrado, o termina por inactividad. | sin columna: se considera al calificar la sección |

### 2.8 Cierre (peso 5) — columna `h_seccion__cierre`

Se mira lo que dice el agente en sus últimos mensajes (los últimos 3 mensajes del agente, valor SUPUESTO).

| ID | Origen | Clase | Cumple / no_cumple / no_aplica | Columna |
|---|---|---|---|---|
| `cierre.agradece` | JS | **clave** | Cumple: agradece al cliente al cerrar. No cumple: no agradece. No aplica: nunca. | `h_cierre__agradece` |
| `cierre.nombre_agente` | JS | complementario | Cumple: se despide diciendo su nombre. No cumple: no lo dice. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `cierre.marca` | JS | complementario | Cumple: nombra la marca en el cierre. No cumple: no. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `cierre.frase_cortesia` | JS | complementario | Cumple: usa una frase de cortesía ("que tengas buen día", etc.). No cumple: no. No aplica: nunca. | sin columna: se considera al calificar la sección |
| `cierre.despedida` | JS | **clave** | Cumple: se despide formalmente, o cierra con el aviso de cierre por inactividad. No cumple: la conversación termina sin despedida. No aplica: nunca. | `h_cierre__despedida` |

---

## 3. Criterio de calificación de las secciones (decisión tuya)

> **Decisión del dueño: calificas cada sección con tu criterio de supervisor.**
>
> Para cada `h_seccion__*` decides tú, `cumple`, `parcial`, `no_cumple` o `no_aplica`, considerando todo lo que ves en la conversación, **incluidos los subelementos complementarios que no tienen columna**. No tienes que calcular nada ni aplicar una fórmula.

La regla D1 de `contrato/rubrica.md` sección 2.1 (cómo el sistema convierte subelementos en resultado de sección) se explica aquí **solo como referencia**, no como instrucción:

1. Se consideran solo los subelementos clave y complementarios que no sean `no_aplica`. Los informativos se ignoran.
2. Si ninguno aplica, la sección es `no_aplica`.
3. Si falla cualquier subelemento clave, la sección es `no_cumple`.
4. Si ningún clave falla y todos los aplicables cumplen, la sección es `cumple`.
5. Si fallan complementarios: `parcial` cuando fallan la mitad o menos de los complementarios aplicables, y `no_cumple` cuando fallan más de la mitad (umbral `umbral_desempate_complementarios = 0.5`).

**Qué hacer cuando tu juicio difiera de D1.** Califica con tu criterio y anótalo en `comentarios_humano` con este formato sugerido:

```
D1: <seccion> difiero: <motivo breve>
```

En `<seccion>` escribe el ID exacto de la sección, en minúsculas y sin acentos: `apertura`, `empatia`, `diagnostico`, `solucion`, `comunicacion`, `recapitulacion`, `ayuda_adicional` o `cierre`. No nombres otras secciones en el motivo: el validador cuenta la anotación por coincidencia del nombre dentro del mismo renglón que empieza con `D1:`.

Si hay varias secciones, una línea por sección (un salto de línea entre cada una; si las separas con punto y coma en el mismo renglón, el validador no distingue a cuál sección se refiere cada una). Esas diferencias son evidencia para revisar la regla D1 en la Fase 4. No necesitas anotar cuando coincides con D1.

Notas prácticas:

- El validador **no bloquea** tus diferencias con D1: las reporta como advertencias (ver sección 7).
- Las advertencias D1 del validador son parciales: solo ven los 19 subelementos clave con columna, no los complementarios. Que no haya advertencia no confirma que tu juicio coincida con D1.
- Si una sección queda sin nada que evaluar, usa `no_aplica`. Las secciones `no_aplica` no cuentan en la nota (se renormaliza).
- La nota humana no la calculas tú: la calcula la Métrica (W3) con tus columnas `h_seccion__*` y `h_critico__*`.

---

## 4. Validación de identidad

`identidad` no es una sección con peso. Es un bloque de 3 subelementos (columnas AJ a AL) que además puede activar el crítico `validacion_identidad`.

### 4.1 Cuándo aplica

El bloque **aplica** si en la conversación ocurre al menos una de estas dos cosas:

- el agente **da información de la cuenta** (datos o casos del cliente), o
- el agente **pide datos de identidad** (correo, RFC, teléfono, nombre del titular, o similares).

Si no ocurre ninguna, los tres `h_identidad__*` son `no_aplica`.

### 4.2 Regla de validación

- La validación es **exitosa** si el cliente acierta al menos **2 datos distintos** de los datos comparables: `correo`, `rfc`, `telefono` y `titular`, contra la cuenta (`cuentas`).
- Un dato que el cliente no sabe o no da cuenta como **no acertado**. Un dato incorrecto también.
- Los datos incorrectos no hacen fallar la validación por sí mismos; solo importa si se llega a 2 aciertos.
- Un mismo tipo de dato cuenta una sola vez, aunque se repita o corrija.
- Cuentan los datos que el cliente dio **antes** de que el agente diera información de la cuenta, aunque los haya dado antes de que el agente los pidiera (por ejemplo, en su primer mensaje).
- No cuentan como datos de identidad los canales oficiales de la empresa, los RFC genéricos, ni los datos de terceros (por ejemplo, el RFC del receptor de una factura).

### 4.3 Datos alternativos

Si el cliente falla o no sabe un dato, el agente puede pedir **datos alternativos** antes de declinar, y esos datos cuentan para el mínimo de 2. Los alternativos válidos son los mismos datos comparables (correo, RFC, teléfono, titular); no hay otros.

### 4.4 Regla del titular

El nombre del titular solo cuenta como dato **acertado** cuando coincide con el titular de la cuenta (nombre completo, o nombre de pila más apellido, sin importar acentos ni mayúsculas). **Nunca** se considera un dato incorrecto: si el cliente da un nombre que no coincide, simplemente no suma. (Un nombre de pila solo no es un dato de identidad.)

### 4.5 Si no se llega a 2 datos acertados

El agente debe **declinar** (negarse con cortesía a dar información de la cuenta) y no dar información de la cuenta. Si da esa información, se activa el crítico `validacion_identidad`.

### 4.6 "Sigue pidiendo datos"

Si el cliente no llegó al mínimo, el agente no da información de la cuenta y no declina, aún cumple si **sigue pidiendo datos** (alternativos o los mismos). Para el sistema, el agente "sigue pidiendo datos" cuando su último mensaje (sin contar despedida ni mensajes de inactividad) pide datos de identidad o el número de caso, y es posterior al último mensaje del cliente que aporta datos de identidad. Si el cliente abandona tras la solicitud (hay cierre por inactividad), no es falla del agente.

**El número de caso actual:**

- No es información de la cuenta. Dar o confirmar el número de caso de la conversación en curso no es revelar datos.
- Revelar el contenido de casos **anteriores** sí es información de la cuenta.
- El número de caso **no cuenta** como dato válido para llegar a los 2 datos acertados (está reservado para una fase posterior). Pedirlo o recibirlo no es error del agente.
- Pero **pedir el número de caso cuenta como "seguir pidiendo datos"** en `h_identidad__datos_coinciden`.

### 4.7 Los tres subelementos de identidad

| ID | Columna | Cumple | No cumple | No aplica |
|---|---|---|---|---|
| `identidad.pide_datos` | `h_identidad__pide_datos` | El agente pide los datos de validación (da igual si el cliente los da). | El bloque aplica y el agente nunca los pide. | El bloque no aplica. |
| `identidad.datos_coinciden` | `h_identidad__datos_coinciden` | La validación fue exitosa; o no lo fue y el agente declinó; o no lo fue y el agente siguió pidiendo datos; o el cliente abandonó tras la solicitud. | La validación no fue exitosa y el agente dio información de la cuenta; o no fue exitosa y el agente ni reveló nada, ni declinó, ni siguió pidiendo (cambia de tema, da largas o cierra sin declinar). | El agente nunca pidió datos, o el bloque no aplica. |
| `identidad.orden_validacion` | `h_identidad__orden_validacion` | El agente no dio información de la cuenta, o la dio **después** de que el cliente acertó 2 datos. | El agente dio información de la cuenta antes de la validación, sin validación, o sin que el cliente llegara a 2 aciertos. | El bloque no aplica. |

### 4.8 Caso sin crítico: no declina pero no revela

Hay un caso en que `h_identidad__datos_coinciden` es `no_cumple` y el crítico `validacion_identidad` es `no`: el cliente no llegó a 2 datos acertados, el agente **no reveló** información de la cuenta, **no declinó** y **no siguió pidiendo datos** (cambió de tema, dio largas o cerró sin declinar). Es una falla, pero sin riesgo de revelación, así que no es crítico.

### 4.9 Tabla de casos de la rúbrica (rúbrica §4)

Esta tabla viene de la rúbrica (con mínimo de 2 datos acertados); no describe ninguna conversación en particular.

| Caso | `pide_datos` | `datos_coinciden` | `orden_validacion` | Crítico `validacion_identidad` |
|---|---|---|---|---|
| Pide, el cliente da 2 datos correctos y luego recibe información | cumple | cumple | cumple | no |
| Pide 3 datos, el cliente acierta 2 de 3 y luego recibe información (exitosa) | cumple | cumple | cumple | no |
| Pide 3 datos, el cliente acierta 1 y no sabe los otros 2; el agente declina y no da información | cumple | cumple | cumple | no |
| Igual al anterior, pero el agente da información de la cuenta | cumple | no_cumple | no_cumple | si |
| Pide 2, el cliente acierta 1 y falla 1; el agente pide un alternativo, el cliente lo acierta y luego recibe información (2 acertados) | cumple | cumple | cumple | no |
| El cliente da su RFC en el primer mensaje, el agente pide datos, el cliente da su correo y luego recibe información | cumple | cumple | cumple | no |
| El cliente da RFC y correo correctos en el primer mensaje, el agente nunca los pide y da información | no_cumple | no_aplica | cumple | si (por `pide_datos`) |
| Pide, el cliente no acierta 2, el agente declina y no da información | cumple | cumple | cumple | no |
| Pide, el cliente no acierta 2 y el agente da información | cumple | no_cumple | no_cumple | si |
| Pide, el cliente no acierta 2, el agente no da información y sigue pidiendo datos | cumple | cumple | cumple | no |
| Pide, el cliente no acierta 2, el agente no da información, no declina y cambia de tema o da largas | cumple | **no_cumple** | cumple | **no** |
| Pide, el cliente da datos insuficientes, el agente no da información y solo se despide sin declinar | cumple | **no_cumple** | cumple | **no** |
| Pide datos y el cliente abandona (recordatorio y cierre por inactividad) | cumple | cumple | cumple | no |
| Pide datos, pero da información antes de que el cliente complete la validación | cumple | según los datos anteriores a la información (si no llegó a 2, no_cumple) | no_cumple | si |
| No pide datos y da información de la cuenta | no_cumple | no_aplica | no_cumple | si |
| No pide datos y no da información de la cuenta | bloque no_aplica | no_aplica | no_aplica | no |

### Inactividad del cliente vs abandono del agente

Dos situaciones distintas que importan para varias columnas:

- **Termina por inactividad del cliente:** el agente envía un recordatorio ("¿sigues ahí?"), después envía un cierre por inactividad, y el cliente no escribe entre ambos. Efecto: `recapitulacion.recapitula` y `recapitulacion.uso_solucion_seguimiento` son `no_aplica`; toda la sección de ayuda adicional es `no_aplica`; `cierre.despedida` cumple con el cierre por inactividad. No es abandono.
- **Abandono del agente (crítico `abandono`):** el último mensaje del cliente se queda sin respuesta del agente. **Excepción:** si antes de ese mensaje el agente ya había dado la despedida o el cierre por inactividad (por ejemplo, el cliente escribe "gracias" después de la despedida), no es abandono.
- Si la conversación termina con un mensaje del agente sin despedida ni cierre por inactividad (por ejemplo, una pregunta sin respuesta), **no** es abandono; falla `cierre.despedida`.

---

## 5. Errores críticos

Son 12 columnas (AM a AX) con valores `si` o `no`.

- **`si`**: el error ocurrió en esta conversación.
- **`no`**: no ocurrió.
- Un solo crítico `si` hace que la nota final del sistema sea **0**, sin importar el resto.
- Cada crítico `si` exige un comentario no vacío en `comentarios_humano`. Es una convención sugerida (no un requisito del contrato) que el comentario indique el **número de mensaje** y una **justificación breve**; el validador solo exige que el comentario no esté vacío.

Aunque un crítico lleve a nota 0, califica el resto de la fila con normalidad. Los críticos no cambian el resultado de las secciones por sí mismos.

| Columna | Crítico | Es `si` cuando |
|---|---|---|
| `h_critico__no_toma_a_tiempo` | No toma a tiempo | El agente tarda más del tiempo permitido en contestar el primer mensaje del cliente, o nunca contesta. |
| `h_critico__no_genera_caso` | No genera caso | La conversación no tiene número de caso registrado (ver `metadatos_caso_legible`). |
| `h_critico__abandono` | Abandono | El último mensaje del cliente queda sin respuesta del agente (con la excepción de despedida o cierre por inactividad previos; ver sección 4). |
| `h_critico__palabras_altisonantes` | Palabras altisonantes | El agente usa groserías o palabras altisonantes. |
| `h_critico__validacion_identidad` | Validación de identidad | El agente da información de la cuenta sin validar bien: no pidió datos, dio información antes de que el cliente acertara 2 datos, o la dio sin que el cliente alcanzara el mínimo en vez de declinar. No es `si` si el agente no reveló información (ver 4.8). |
| `h_critico__confidencialidad` | Confidencialidad | El agente revela información confidencial: datos completos de la cuenta que el cliente no dio, datos de terceros o información interna. El enmascarado parcial permitido tras una validación exitosa no cuenta (correo con la primera letra y el dominio; teléfono con los últimos 4 dígitos; RFC con los últimos 3 caracteres). Antes de validar, cualquier mención de datos registrados, completa o parcial, es revelación. Salvedad (rúbrica §5): cuenta como revelación un dato registrado que el cliente no escribió completo antes en la conversación; un dato que el cliente dio completo y el agente repite no cuenta. Los canales oficiales y los RFC genéricos nunca cuentan. |
| `h_critico__tipificacion_incorrecta` | Tipificación incorrecta | La tipificación registrada por el agente no corresponde al tema real de la conversación. |
| `h_critico__informacion_incorrecta` | Información incorrecta | El agente da información incorrecta respecto a la base de conocimiento **con impacto** para el cliente: puede causar pérdida o cobro de dinero, incumplir un plazo legal o fiscal, sanción o multa del SAT, pérdida o corrupción de datos, o acceso indebido a la cuenta. Si el error no tiene esas consecuencias, solo afecta `h_solucion__informacion_correcta`. |
| `h_critico__promesa_no_autorizada` | Promesa no autorizada | El agente promete algo que la base no autoriza (descuentos, reembolsos, plazos o promociones no vigentes). |
| `h_critico__negacion_servicio` | Negación de servicio | El agente se niega a atender una solicitud que sí corresponde al soporte. |
| `h_critico__mala_actitud` | Mala actitud | Sarcasmo, burla, culpar al cliente o trato despectivo. |
| `h_critico__comentarios_negativos_marca` | Comentarios negativos de la marca | El agente habla mal de la marca, de sus productos o de la empresa. |

### Contradicciones de definición (el validador las trata como error)

Estas combinaciones son contradictorias según la rúbrica y bloquean la validación. Si te salen, revisa la fila: o una de las dos columnas está mal, o tienes que anotar el motivo y corregir la otra.

| Si pones... | Entonces debes poner... | Por qué |
|---|---|---|
| `h_critico__tipificacion_incorrecta = si` | `h_recapitulacion__tipificacion = no_cumple` | El crítico es exactamente ese subelemento fallando. |
| `h_critico__no_toma_a_tiempo = si` | `h_apertura__toma_a_tiempo = no_cumple` | El crítico es exactamente ese subelemento fallando. |
| `h_critico__validacion_identidad = si` | al menos un `h_identidad__*` en `no_cumple` | El crítico se activa porque falla algún subelemento de identidad. |

Solo se revisa en ese sentido. Por ejemplo, `h_identidad__datos_coinciden = no_cumple` con crítico `no` es válido (caso 4.8).

---

## 6. Cómo preparar la hoja en Google Sheets (validación de datos manual)

Haz esto una vez, antes de calificar. Las letras de columna salen de la tabla de la sección 1 (y de `contrato/sheets.md`).

### 6.1 Validación de datos con lista desplegable

Para cada grupo: selecciona el rango (desde la fila 2 hasta una fila holgada, por ejemplo la 200, para cubrir el lote), menú **Datos > Validación de datos > Agregar regla**, criterio **Menú desplegable (de un intervalo)** o **Menú desplegable** con los elementos indicados; en **Opciones avanzadas > Si los datos no son válidos** elige **Rechazar entrada**; guarda.

| Grupo | Rango (columnas) | Elementos del menú |
|---|---|---|
| Secciones | `I2:P200` (posiciones 9 a 16, `h_seccion__*`) | `cumple`, `parcial`, `no_cumple`, `no_aplica` |
| Subelementos clave | `Q2:AI200` (posiciones 17 a 35) | `cumple`, `no_cumple`, `no_aplica` |
| Identidad | `AJ2:AL200` (posiciones 36 a 38) | `cumple`, `no_cumple`, `no_aplica` |
| Críticos | `AM2:AX200` (posiciones 39 a 50, `h_critico__*`) | `si`, `no` |
| Estado | `H2:H200` (posición 8, `estado_revision`) | `pendiente`, `calificada` |

Nota: los dos grupos con los mismos tres valores (Q a AI y AJ a AL) pueden crearse como una sola regla en `Q2:AL200`.

### 6.2 Proteger las columnas de contexto

1. Menú **Datos > Proteger hojas y rangos > Agregar hoja o rango**.
2. En el rango escribe `A:G`, pulsa **Establecer permisos** y deja solo a tu cuenta con permiso de edición (o activa "Mostrar una advertencia al editar").

Resultado: las columnas A a G (contexto) quedan protegidas; `estado_revision` (H) y las demás siguen editables.

### 6.3 Congelar encabezado y columnas iniciales

- **Ver > Inmovilizar > 1 fila** (el encabezado).
- **Ver > Inmovilizar > Hasta la columna E** (hasta `cuenta_id`) o, si tu pantalla es chica, hasta la columna A o B, para que `conversation_id` siempre se vea al desplazarte hacia las columnas `h_*`.

### 6.4 Ajuste de línea en `texto_legible`

1. Selecciona la columna G (`texto_legible`).
2. Menú **Formato > Ajuste de texto > Ajustar** (o el botón de ajuste de texto de la barra).
3. Ensancha la columna G y, si hace falta, aumenta la altura de fila para leer toda la conversación sin abrir la celda. Haz lo mismo con la columna F (`metadatos_caso_legible`).

### 6.5 Formato de `calificado_en` (columna AZ)

1. Selecciona la columna AZ (`calificado_en`).
2. Menú **Formato > Número > Texto sin formato**, para que Sheets no convierta lo que escribas a una fecha local (por ejemplo DD/MM/AAAA), que el validador rechaza como error.
3. Escribe la fecha y hora como `AAAA-MM-DD HH:MM` o `AAAA-MM-DD HH:MM:SS` (por ejemplo `2026-11-05 18:30`). También se acepta una `T` en lugar del espacio y un desfase opcional al final (`Z` o `+hh:mm`/`-hh:mm`). Se valida que la fecha exista (no 31 de febrero).

### 6.6 Recordatorio de ceguera

Mientras preparas y llenas la hoja, **no abras las hojas `evaluaciones` ni `escenarios`**, ni ningún archivo con resultados del sistema o la verdad del escenario, hasta terminar de calificar todo el lote.

---

## 7. Cómo exportar a CSV y cómo correr el validador

### 7.1 Exportar

1. Con la hoja `revision_humana` abierta, menú **Archivo > Descargar > Valores separados por comas (.csv)**. Google exporta la **hoja activa**.
2. Guarda el archivo en una ruta de tu equipo (por ejemplo, dentro del repositorio, en una carpeta que no se publique si prefieres mantener tus calificaciones privadas hasta cerrar la fase).
3. Conserva el encabezado de 52 columnas tal cual: el validador lo usa para identificar cada columna.

### 7.2 Validar

**Orden del flujo.** Antes de exportar, deja las 24 filas con `estado_revision = calificada` y `calificado_en` lleno. El validador da error si cualquier fila no está en `calificada`, así que no sirve validar con filas todavía `pendiente`.

Desde la raíz del repositorio:

```
node js/validador_revision_humana.js <ruta.csv>
node js/validador_revision_humana.js <ruta.csv> --esperadas N
```

(Reemplaza `<ruta.csv>` por la ruta del archivo exportado. Por defecto espera 24 filas; `--esperadas N` cambia ese número, por ejemplo para un lote distinto.) El validador revisa tus calificaciones y devuelve un reporte.

**Errores (bloquean; hay que corregirlos antes de dar la calificación por terminada):**

- encabezado distinto de las 52 columnas esperadas, en su orden;
- número de filas de datos distinto de 24 (o de N, con `--esperadas N`), o fila con número de campos incorrecto;
- `conversation_id` vacío o duplicado;
- `estado_revision` distinto de `calificada`;
- `calificado_en` vacío o con formato inválido (ver 6.5);
- celdas `h_*` vacías;
- valores no permitidos en una columna `h_*` (por ejemplo, `parcial` en un subelemento clave, o `Cumple` con mayúscula);
- crítico `si` sin comentario en `comentarios_humano`;
- las 3 contradicciones de definición de la sección 5:
  - `tipificacion_incorrecta = si` sin `h_recapitulacion__tipificacion = no_cumple`;
  - `no_toma_a_tiempo = si` sin `h_apertura__toma_a_tiempo = no_cumple`;
  - `validacion_identidad = si` sin ningún `h_identidad__*` en `no_cumple`.

**Advertencias (no bloquean; se reportan como conteo):**

- diferencias entre tu calificación de una sección y lo que daría la regla D1 (sección 3). Son esperadas cuando tu criterio de supervisor difiere; anótalas en `comentarios_humano` con el formato de la sección 3 para que queden como evidencia para la Fase 4.

**Códigos de salida:** `0` sin errores; `1` con errores; `2` error de uso o archivo ilegible. Las advertencias nunca cambian el código de salida.

Corrige los errores en la hoja, vuelve a exportar y vuelve a correr el validador hasta que no queden errores. Después avisa para cerrar la fase. Solo entonces puedes abrir `evaluaciones` y `escenarios`.
