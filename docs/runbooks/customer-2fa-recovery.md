# Protocolo Operativo: Recuperación de 2FA para Clientes (Dueño / Owner)

| Metadato         | Valor                                    |
| ---------------- | ---------------------------------------- |
| Documento        | `docs/runbooks/customer-2fa-recovery.md` |
| Rol ejecutor     | Únicamente `owner` (Dueño de Yékora)     |
| Permiso API      | `roles:manage`                           |
| Rate Limit       | 10 intentos/min por IP (`LIMITED`)       |
| Feature Contract | `079_FC` (K-64c · Enmienda 3)            |
| Fecha            | 2026-11-28                               |

---

## 1. Propósito y Alcance

Este procedimiento operativo describe los pasos obligatorios que el Dueño (`owner`) debe ejecutar fuera de banda para verificar fehacientemente la identidad de un cliente/comprador sin rol privilegiado (`!isPrivileged(roles)`, cuentas `customer`) que ha extraviado tanto su dispositivo de autenticación (TOTP) como la totalidad de sus códigos de respaldo de 8 dígitos, solicitando la desactivación de su segundo factor para recuperar el acceso a su cuenta en Yékora.

> **REGLAS TAXATIVAS:**
>
> 1. Este protocolo aplica **exclusivamente a cuentas de clientes sin privilegios administrativos (`!isPrivileged(roles)`)**.
> 2. Las cuentas de personal administrativo, soporte o catálogo (`staff_*`, `admin`, `owner`) **tienen 2FA estrictamente obligatorio** y el sistema rechazará cualquier intento de desactivación con código `STAFF_2FA_CANNOT_BE_RECOVERED`.

---

## 2. Recepción de la Solicitud

El cliente remitirá un correo electrónico a `contacto@yekora.mx` desde la misma dirección asociada a su cuenta de compras, manifestando la pérdida de su autenticador y códigos de respaldo.

---

## 3. Verificación de Identidad Fuera de Banda (Humana)

Antes de proceder en el panel administrativo, el Dueño debe validar un mínimo de **tres (3)** de los siguientes elementos de control:

1. **Procedencia del Mensaje:** Verificar que los encabezados SPF/DKIM/DMARC del correo entrante coincidan con el dominio emisor del proveedor del cliente.
2. **Historial de Pedidos:** Solicitar al cliente los números de al menos dos pedidos recientes, monto aproximado y fechas aproximadas de compra.
3. **Dirección de Envío Registrada:** Solicitar al cliente la confirmación exacta del código postal, calle y número de su dirección de entrega habitual.
4. **Últimos 4 dígitos del método de pago:** En caso de compras con tarjeta en Stripe, cotejar los últimos 4 dígitos y marca de la tarjeta utilizada en pedidos previos.
5. **Comprobación telefónica:** Llamar al número telefónico de contacto registrado en la cuenta o en pedidos anteriores para validar verbalmente la solicitud.

---

## 4. Ejecución en la Plataforma

Una vez validada positivamente la identidad:

1. Iniciar sesión como `owner` en la consola administrativa (exige permiso `roles:manage`).
2. Ingresar a la sección de Recuperación de 2FA de Clientes (`POST /v1/admin/users/recover-2fa`).
3. Introducir la dirección de correo exacta del cliente (`targetEmail`).
4. Ingresar un motivo detallado (`reason`, mínimo 10 caracteres) resumiendo los elementos de verificación cotejados (ej. «Cotejo de pedidos previos, dirección postal y confirmación telefónica»).
   > **ADVERTENCIA DE PRIVACIDAD (CERO-PII):** No incluya datos personales directos (nombres completos, números de teléfono, correos o números de tarjeta) en el texto del motivo.
5. Introducir el código TOTP vigente del propio Dueño para validación de step-up (`verifyStepUpTotp`).
6. Confirmar la ejecución.

---

## 5. Efectos Automatizados en el Sistema

Al procesar la solicitud, el sistema ejecuta atómicamente:

1. `two_factor_auth.is_totp_enabled = 0` y eliminación del secreto TOTP temporal/permanente.
2. Eliminación de todos los códigos de respaldo en `two_factor_backup_codes`.
3. Revocación total de sesiones y dispositivos de confianza (`revokeAccess`).
4. Inserción de bitácora Cero-PII en la tabla viva `audit_log`:
   - `user_id`: id del Dueño (`req.user.id`).
   - `action`: `'CUSTOMER_2FA_RESET_BY_OWNER'`.
   - `entity_type`: `'user'`.
   - `entity_id`: id de la cuenta afectada (`targetUser.id`, tipo texto).
   - `after_state`: `{ reason }`.
   - `ip_address`: IP del Dueño (`req.ip`).
5. Encolado y envío automático de correo transaccional de alerta al cliente informándole que su segundo factor ha sido desactivado por solicitud y recomendándole iniciar sesión y configurar uno nuevo.
