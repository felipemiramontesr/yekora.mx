# Permisos de la clave de Stripe (`STRIPE_SECRET_KEY`)

El API habla con Stripe con una **clave restringida** (`rk_test_…` en `sandbox`, `rk_live_…` en `live`; el API no arranca si el prefijo no coincide con `PAYMENTS_MODE`). Una clave restringida solo hace lo que se le permitió: es lo correcto por mínimo privilegio. Cada función nueva que llama a Stripe puede pedir un permiso más; si falta, Stripe responde `403 more_permissions_required` y el API contesta `503 SERVICE_UNAVAILABLE`.

## Permisos que necesita hoy

| Permiso en Stripe (Developers › API keys › la clave › Edit) | Nivel                | Para qué lo usa el API                                                                                                      | Desde          |
| ----------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Checkout Sessions**                                       | Write                | crear la sesión de pago (tarjeta y OXXO), crear la sesión de configuración de tarjeta, leer una sesión al conciliar un pago | FC 012, FC 054 |
| **Customers**                                               | Write                | crear el cliente de Stripe de una cuenta la primera vez que guarda una tarjeta                                              | FC 054         |
| **PaymentMethods**                                          | Write (incluye Read) | listar las tarjetas de un cliente, comprobar de quién es una tarjeta y desvincularla                                        | FC 054         |

Los webhooks (`STRIPE_WEBHOOK_SECRET`) no usan la clave: se verifican con su firma, sin llamar a Stripe.

## Si falla «Agregar tarjeta»

1. Abrir en Hostinger › `apiv1.yekora.mx` › **Runtime logs** y buscar «saved cards» (severidad Warning).
2. La línea trae el motivo de Stripe: `Stripe: HTTP <estado> (<tipo> <código> <parámetro>)`. `more_permissions_required` quiere decir que a la clave le falta un permiso de la tabla de arriba.
3. Subir ese permiso a la **misma** clave en el panel de Stripe (no hace falta clave nueva ni tocar Hostinger: se aplica al instante) y repetir la acción.

## Nota

El texto libre del error de Stripe no se registra a propósito (puede repetir parte de la clave). Si el tipo, el código y el parámetro no bastan, el panel de Stripe (Developers › Logs) muestra la petición completa.
