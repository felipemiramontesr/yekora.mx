# Procedimiento P · Pagos y credenciales

Cómo rotar las llaves de pago, cambiar entre pruebas y producción, y responder si una llave se
filtró (FC 075, K-75 segunda parte). Los secretos viven solo en las variables de entorno de la
API en Hostinger; nunca en la base de datos, en el repositorio ni en un mensaje.

## 1. Rotar un secreto de webhook sin perder avisos

`STRIPE_WEBHOOK_SECRET` y `MP_WEBHOOK_SECRET` admiten **dos** valores separados por coma: la API
acepta un aviso firmado con cualquiera de los dos.

1. En el panel del procesador, genera el secreto nuevo (Stripe: «Roll secret», y elige mantener
   el anterior activo un tiempo).
2. En Hostinger, deja la variable como `secreto_nuevo,secreto_viejo` y vuelve a desplegar.
3. Corre `bun scripts/verifyPaymentsBunker.ts --check-rotation` con el entorno de producción:
   debe decir que hay una rotación en curso y no reportar fallos.
4. Cuando el procesador ya solo firme con el nuevo, quita el viejo (queda un solo valor) y
   vuelve a desplegar.

## 2. Rotar la llave secreta de un procesador

1. Crea la llave nueva en el panel (en producción, una llave **restringida** `rk_live_` con solo
   los permisos que usa la tienda; ver `stripe-api-key-permissions.md`).
2. Cámbiala en Hostinger y vuelve a desplegar. La API se niega a arrancar si la llave no es del
   modo declarado.
3. Prueba con una compra pequeña y su reembolso, y revoca la llave vieja en el panel.

## 3. Cambiar entre pruebas y producción

La API **no cambia de modo sola**: el interruptor deja una aprobación y el arranque la exige.

1. El Dueño o un administrador pide el cambio: `POST /v1/admin/payments/mode/prepare` con el modo
   y el motivo. La respuesta es un ticket que dura 10 minutos.
2. El **Dueño** lo confirma: `POST /v1/admin/payments/mode/confirm` con el ticket, la frase exacta
   (`CONFIRMAR_CAMBIO_A_LIVE` o `CONFIRMAR_CAMBIO_A_SANDBOX`) y el código de su autenticador.
   Hay tres intentos.
3. Con la aprobación, y **antes de 24 horas**, cambia en Hostinger `PAYMENTS_MODE` y las llaves
   del modo, y vuelve a desplegar. En producción, el primer arranque dentro de la ventana activa
   la aprobación; después, los reinicios valen mientras sea la última aprobación.
4. Si la API no arranca con «PAYMENTS_MODE=live has no approval…» o «…expired before it was
   activated», vuelve al paso 1. No hay atajo.

Volver a pruebas no exige aprobación para arrancar. Regresar a producción pide una aprobación
nueva.

## 4. Si sospechas que una llave se filtró (`LEAKED_KEY`)

1. **Cierra primero, investiga después.** En el panel del procesador revoca la llave filtrada.
2. Si no puedes poner de inmediato una llave nueva, quita las variables del procesador en
   Hostinger y vuelve a desplegar: el pago queda cerrado (503) en lugar de usar una llave
   comprometida.
3. Genera llaves y secretos nuevos y cárgalos (secciones 1 y 2).
4. Revisa en el panel del procesador los cobros y reembolsos recientes, y en la bitácora de la
   tienda las acciones de las cuentas con acceso.
5. Corre `bun scripts/verifyPaymentsBunker.ts --check-rotation`: busca llaves en claro en el árbol
   de trabajo y revisa las listas de secretos.
6. Anota qué pasó en `incident-response.md`.

## 5. Avisos automáticos

El Dueño y los administradores reciben un correo cuando se aprueba un cambio de modo, cuando un
procesador no responde a la revisión de salud (máximo uno por hora) y cuando llegan 10 o más
avisos con firma inválida en 10 minutos (máximo uno por hora).
