# Base de conocimiento de Contamix (datos sintéticos)

Artículos ficticios de soporte de **Contamix**, software contable en la nube para pymes en México. Son datos sintéticos para el proyecto de QA: simplifican las reglas fiscales reales y **no son asesoría fiscal**. Los dominios usan el TLD reservado `.example` y los teléfonos son ficticios.

## Formato (para cargar la hoja `base_conocimiento`)

- Una sección `## KB-nn` por artículo; cada artículo es una fila de la hoja.
- Las viñetas en negritas `id_articulo`, `titulo`, `tema`, `tipo_interaccion` y `actualizado_en` son las columnas del mismo nombre de `contrato/sheets.md`.
- Los subtítulos `### contenido`, `### plazos`, `### casos_escalamiento` y `### promociones_autorizadas` son las columnas del mismo nombre; su texto completo (hasta el siguiente subtítulo) es el valor de la celda.
- `_(vacío)_` significa celda vacía.
- `tema` es exactamente un valor de `catalogo_temas.tema`.

---

## KB-01

- **id_articulo:** KB-01
- **titulo:** Emisión y timbrado de CFDI 4.0
- **tema:** Emisión de CFDI
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
Para emitir una factura (CFDI 4.0) en Contamix: 1) Ir a Facturación > Nueva factura. 2) Capturar o elegir al cliente receptor; en CFDI 4.0 el RFC, el nombre o razón social (sin régimen societario, por ejemplo sin "SA de CV"), el código postal del domicilio fiscal y el régimen fiscal del receptor deben coincidir exactamente con su Constancia de Situación Fiscal. 3) Elegir el uso de CFDI que indique el receptor, la forma de pago y el método de pago (PUE si se paga en una sola exhibición al emitir; PPD si se paga en parcialidades o después). 4) Agregar conceptos con su clave de producto o servicio. 5) Dar clic en Timbrar. Contamix envía la factura al proveedor de certificación y, si se acepta, genera el XML y el PDF y los envía al correo del receptor.

Si el timbrado se rechaza, Contamix muestra el motivo en pantalla. Los rechazos más comunes son por datos del receptor que no coinciden con su constancia (nombre, código postal o régimen fiscal). Solución: pedir al cliente que compare los datos con la Constancia de Situación Fiscal actualizada del receptor, corregirlos en Catálogos > Clientes y volver a timbrar. El soporte no puede modificar ni timbrar facturas por el cliente. Para facturar al público en general se usa el RFC genérico XAXX010101000 con el nombre "PUBLICO EN GENERAL".

El certificado de sello digital (CSD) debe estar vigente y cargado en Configuración > Datos fiscales; si venció, el cliente debe tramitar uno nuevo ante el SAT y cargarlo.

### plazos
Si el timbrado falla por una causa del servicio de Contamix (no por datos del receptor), Soporte Nivel 2 responde en un máximo de 24 horas hábiles.

### casos_escalamiento
Se escala a Soporte Nivel 2 solo si el rechazo persiste con datos del receptor ya verificados contra la constancia, si aparece un error de servicio no disponible por más de 30 minutos, o si el timbrado se cobró pero no se generó el XML. Los rechazos por datos del receptor no se escalan: se resuelven en la conversación.

### promociones_autorizadas
_(vacío)_

---

## KB-02

- **id_articulo:** KB-02
- **titulo:** Cancelación de CFDI
- **tema:** Cancelación de CFDI
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
Para cancelar una factura en Contamix: 1) Ir a Facturación > Facturas emitidas y buscar la factura por folio o UUID. 2) Dar clic en Cancelar. 3) Elegir el motivo de cancelación del SAT: 01 Comprobante emitido con errores con relación (primero se emite la factura que sustituye y se indica su UUID); 02 Comprobante emitido con errores sin relación; 03 No se llevó a cabo la operación; 04 Operación nominativa relacionada en una factura global. 4) Confirmar.

Si la factura requiere aceptación del receptor (por ejemplo, total mayor a 1,000 pesos), queda en estatus "En proceso de cancelación" y el receptor la acepta o rechaza en el portal del SAT. Si el receptor la rechaza, la factura sigue vigente y el cliente debe ponerse de acuerdo con su receptor; Contamix no puede forzar la cancelación. Para facturas de motivo 01 hay que timbrar primero la sustituta. Una factura cancelada no se puede reactivar.

El soporte guía al cliente en el proceso, pero no cancela facturas en su nombre.

### plazos
El receptor tiene 72 horas para aceptar o rechazar; si no responde, la cancelación se considera aceptada. Una factura se puede cancelar a más tardar en el mes en que se presenta la declaración anual del ejercicio en que se emitió (personas morales: marzo del año siguiente; personas físicas: abril del año siguiente). Si una cancelación sigue "En proceso" más de 72 horas sin respuesta del receptor, Soporte Nivel 2 la revisa y responde en un máximo de 48 horas hábiles.

### casos_escalamiento
Se escala a Soporte Nivel 2 cuando la cancelación sigue "En proceso de cancelación" más de 72 horas sin respuesta del receptor, o cuando el SAT ya la muestra cancelada y Contamix todavía la muestra vigente (o al revés). No se escala un rechazo del receptor ni una cancelación fuera del plazo legal: se explica al cliente.

### promociones_autorizadas
_(vacío)_

---

## KB-03

- **id_articulo:** KB-03
- **titulo:** Complemento de pago (recibo electrónico de pago)
- **tema:** Complemento de pago
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
Las facturas emitidas con método de pago PPD requieren un complemento de pago por cada pago recibido. En Contamix: 1) Ir a Facturación > Complementos de pago > Nuevo. 2) Elegir al cliente y la factura PPD que se paga (UUID). 3) Capturar fecha de pago, forma de pago, monto pagado y número de parcialidad; Contamix calcula el saldo insoluto. 4) Timbrar. Las facturas PUE no llevan complemento de pago. Si un pago cubre varias facturas, se pueden relacionar todas en el mismo complemento. Si el complemento tiene un error, se cancela con motivo 01 y se emite uno nuevo que lo sustituya.

### plazos
El complemento de pago se emite a más tardar el día 5 del mes siguiente a aquel en que se recibió el pago.

### casos_escalamiento
_(vacío)_

### promociones_autorizadas
_(vacío)_

---

## KB-04

- **id_articulo:** KB-04
- **titulo:** Inventario: existencias, ajustes y diferencias
- **tema:** Inventario
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
Contamix controla existencias por almacén y por producto (SKU) con costo promedio. Las existencias cambian con compras, ventas facturadas, traspasos entre almacenes y ajustes.

Ajuste de inventario (conteo físico distinto del sistema): 1) Ir a Inventario > Ajustes > Nuevo ajuste. 2) Elegir almacén y producto. 3) Capturar la cantidad contada y el motivo (merma, conteo físico, daño). 4) Guardar. Solo los roles Administrador y Almacenista pueden hacer ajustes. Los ajustes quedan en la bitácora del producto y no se pueden borrar; para corregir uno se hace un ajuste inverso.

Diferencias después de una importación o de la conexión con el punto de venta: primero usar Inventario > Herramientas > Recalcular existencias del almacén afectado. Si la diferencia persiste después de recalcular, es un caso de sincronización y se escala.

### plazos
Recalcular existencias tarda hasta 10 minutos según el número de productos. Soporte Nivel 2 responde los casos de sincronización en un máximo de 48 horas hábiles.

### casos_escalamiento
Se escala a Soporte Nivel 2 cuando la diferencia persiste después de "Recalcular existencias", o cuando las ventas del punto de venta no descuentan existencias. Antes de escalar se capturan almacén, SKU del producto y fecha del movimiento. Un ajuste por conteo físico no se escala.

### promociones_autorizadas
_(vacío)_

---

## KB-05

- **id_articulo:** KB-05
- **titulo:** Usuarios, roles y permisos
- **tema:** Permisos de usuarios
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
Roles disponibles: Administrador (todo, incluidos usuarios y pagos), Contador (contabilidad, facturación y reportes), Facturista (solo emitir y consultar facturas), Almacenista (inventario) y Consulta (solo lectura). Usuarios incluidos por plan: Básico 2, Pyme 5, Empresarial 15.

Solo un usuario Administrador de la cuenta puede dar de alta usuarios, asignar o cambiar roles y desactivar usuarios, en Configuración > Usuarios. El soporte no crea usuarios ni cambia roles por el cliente: lo guía paso a paso. Si el plan llegó a su límite de usuarios, el Administrador desactiva uno existente o cambia de plan.

Cambio de usuario Administrador (por ejemplo, el administrador dejó la empresa): solo lo puede solicitar el titular de la cuenta, con validación de identidad previa. El soporte valida la identidad, registra la solicitud y la escala al área de Cuentas, que hace el cambio. El soporte nunca comparte usuarios, contraseñas ni datos de otros usuarios.

### plazos
El área de Cuentas realiza el cambio de Administrador en un máximo de 24 horas hábiles después de recibir la solicitud validada.

### casos_escalamiento
Se escala al área de Cuentas el cambio de usuario Administrador. Alta de usuarios, cambio de roles y desactivación no se escalan: los hace el Administrador del cliente.

### promociones_autorizadas
_(vacío)_

---

## KB-06

- **id_articulo:** KB-06
- **titulo:** Pagos de la suscripción, cargos y reembolsos
- **tema:** Pagos de suscripción
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
La suscripción se paga mensual o anualmente con tarjeta de crédito o débito, o por transferencia SPEI a la referencia que aparece en Configuración > Mi plan. El método de pago lo cambia el Administrador en Configuración > Mi plan > Método de pago; el soporte no captura datos de tarjetas.

Si un pago falla, la cuenta tiene 7 días naturales de gracia; después pasa a modo solo lectura (se puede consultar y descargar, pero no timbrar). Los datos se conservan 90 días; al pagar se reactiva de inmediato.

Aclaración de cargos (cargo duplicado, monto distinto al plan o cargo después de cancelar): el soporte valida la identidad, registra referencia de pago, fecha y monto del cargo, y escala al área de Cobranza. Solo Cobranza autoriza reembolsos o bonificaciones; el agente no promete reembolsos, montos ni fechas de devolución. El tiempo del depósito de un reembolso aprobado depende del banco del cliente. No existen descuentos fuera de la campaña vigente (ver KB-08).

### plazos
Plazo de seguimiento que el agente compromete: Cobranza da seguimiento y responde la aclaración en un máximo de 48 horas hábiles. Depósito de un reembolso aprobado: depende del banco del cliente; el agente lo informa como "según tu banco", sin comprometer un número de días. Periodo de gracia por pago fallido: 7 días naturales (no es un plazo de seguimiento).

### casos_escalamiento
Se escalan a Cobranza los cargos duplicados, los cargos con monto distinto al plan, los cargos posteriores a una cancelación y cualquier solicitud de reembolso. El cambio de método de pago y la consulta de fechas de cobro no se escalan.

### promociones_autorizadas
Solo la campaña vigente descrita en KB-08.

---

## KB-07

- **id_articulo:** KB-07
- **titulo:** Acceso a la cuenta y datos del titular
- **tema:** Acceso a la cuenta
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
Restablecer contraseña: el usuario da clic en "¿Olvidaste tu contraseña?" en la pantalla de inicio de sesión y recibe un enlace en el correo con el que está dado de alta. El soporte no puede ver, enviar ni cambiar contraseñas, y nunca envía el enlace a un correo distinto del registrado. Si el usuario no recibe el correo, debe revisar la carpeta de spam; si no es Administrador, otro Administrador de la cuenta puede reenviarle la invitación.

Cambio del correo del titular de la cuenta: requiere validación de identidad del titular (al menos dos datos que coincidan con los registrados: correo, RFC o teléfono). El soporte registra la solicitud con el correo nuevo y la escala al área de Cuentas. Antes de validar la identidad, el agente no confirma ni revela ningún dato de la cuenta (correo, teléfono, RFC, plan o pagos). Después de validar, solo puede mencionar los datos registrados enmascarados parcialmente (por ejemplo j***@dominio.example o ******1234).

### plazos
El enlace de restablecimiento vence en 30 minutos. El área de Cuentas cambia el correo del titular en un máximo de 24 horas hábiles.

### casos_escalamiento
Se escala al área de Cuentas el cambio de correo del titular, y también el acceso bloqueado después de 5 intentos fallidos si el restablecimiento de contraseña no lo desbloquea. El restablecimiento de contraseña no se escala.

### promociones_autorizadas
_(vacío)_

---

## KB-08

- **id_articulo:** KB-08
- **titulo:** Planes, campaña vigente y canales de atención
- **tema:** Planes y promociones
- **tipo_interaccion:** ce
- **actualizado_en:** 2026-10-01T09:00:00-06:00

### contenido
Planes (precios mensuales en pesos, más IVA): Básico 349 (2 usuarios, sin inventario), Pyme 699 (5 usuarios, con inventario) y Empresarial 1,299 (15 usuarios, inventario con varios almacenes). El cambio a un plan mayor se aplica de inmediato con cobro proporcional; el cambio a un plan menor se aplica en la siguiente renovación. El Administrador de la cuenta cambia de plan o de pago mensual a anual en Configuración > Mi plan.

Canales de atención oficiales: chat dentro de Contamix, de lunes a viernes de 8:00 a 20:00 y sábados de 9:00 a 14:00 (hora del centro de México); correo soporte@contamix.example; teléfono de soporte 55 5000 1000; teléfono de Cobranza 55 5000 2000; correos facturacion@contamix.example y pagos@contamix.example para temas de cobro. Centro de ayuda con guías: ayuda.contamix.example.

### plazos
La campaña vigente aplica del 1 de octubre al 31 de diciembre de 2026.

### casos_escalamiento
_(vacío)_

### promociones_autorizadas
Campaña "Cierre Fiscal Contamix 2026": 15% de descuento en el pago anual de cualquier plan al contratar o renovar entre el 1 de octubre y el 31 de diciembre de 2026, más acceso gratuito al webinar "Cierre fiscal sin estrés". No aplica a pagos mensuales, no es retroactiva a pagos ya hechos y no se combina con otros descuentos. No existe ninguna otra promoción, descuento, mes gratis o bonificación autorizada.
