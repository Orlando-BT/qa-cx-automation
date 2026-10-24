Lee CLAUDE.md y las definiciones de .claude/agents/. Vamos a iniciar la Fase 0: Contrato.

Primero explícame en lenguaje sencillo cómo vas a coordinar a los subagentes en todo el proyecto y qué hará cada uno. Después preséntame el plan de la Fase 0 y las decisiones pendientes que necesito tomar, con opciones, pros y contras. No lances subagentes ni crees archivos hasta que yo apruebe.

"Iniciamos la Fase 2 (workflows de n8n) en modo plan. Lee CLAUDE.md, docs/registro-tecnico.md y la memoria del proyecto. No ejecutes nada hasta que apruebe el plan.

Decisiones que ya tomé y el plan debe incluir:

Modelo generador: verifícalo en la documentación oficial y fíjalo en el contrato; debe ser de un proveedor distinto al evaluador.
Tope de tokens de salida del evaluador: pasa a ser clave de config, con 8000 hasta resolver el commentary en v2.
Fallas de API: las conversaciones con fallo_api van a una cola de reproceso, ninguna se pierde; los errores HTTP 429 y 5xx se reintentan con espera. El workflow revisa falla_api antes que valido.

Preguntas que el plan debe responder:

¿Cómo usan los nodos de n8n el código de js/ sin duplicarlo? Necesito una sola fuente de verdad y una prueba que confirme que el código de los nodos es igual al del repo.
¿Dónde corre n8n (local o nube) y cómo se manejan las credenciales? Los workflows exportados al repo no deben llevar claves.
¿Qué workflows habrá (W1, W2, simulador…) y qué hace cada uno?
¿Cómo se prueba el flujo completo sin usar el lote calibracion_v1? Mi calificación a ciegas sigue pendiente.

Reglas de trabajo:

Cada commit incluye 'Subagente: <nombre>' y la decisión relacionada; documentacion mantiene docs/bitacora.md (reconstruye Fase 0 y 1 desde Git, marcando lo reconstruido).
Las búsquedas de secretos reportan solo 'encontrado / no encontrado y dónde', nunca el valor.
Del lote, solo totales; nunca resultados por conversación.
Pendiente heredado: la incoherencia entre critico.informacion_incorrecta y solucion.informacion_correcta queda para v2, con métrica en Fase 4."