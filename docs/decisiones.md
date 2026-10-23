Se construyó el contrato, la fuente de la verdad, que funciona como cédula de monitoreo y como guía que comparten los agentes para que no haya variaciones. Los subelementos los evalúan el LLM (los que requieren interpretar lenguaje, con evidencia) y JavaScript (los verificables con reglas); el LLM nunca calcula la nota. Si falla un subelemento clave, la sección queda en No cumple; si fallan complementarios, la sección queda Parcial, y si falla más de la mitad de los complementarios, No cumple. Cada sección aporta su peso completo si cumple, la mitad si es parcial y cero si no cumple. Lo que no aplica se excluye: un subelemento sale del cálculo de su sección y una sección completa sale de la nota, que se recalcula sobre las demás. Si hay error crítico, la nota final es 0, pero se guarda la nota base para poder calibrar por separado.

El contrato va antes del código porque evita que los agentes supongan cosas incorrectas: en lugar de trabajar con un contexto aleatorio, siguen reglas determinadas. Además, corregir un nombre o una regla después obligaría a rehacer código, prompts, hojas y métricas. 
El umbral del desempate (50%) es configurable.
Hay una tercera clase de subelemento, informativo, que se registra pero no entra en la agregación (por ejemplo, el número de preguntas).
Cuando algo se puede calcular, como la inactividad del cliente, el no_aplica lo decide JavaScript, no el LLM. # Mis decisiones

Este archivo lo escribo yo al cerrar cada fase.
