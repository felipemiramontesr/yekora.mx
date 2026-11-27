# Facturación: cómo se entregan las facturas

Para quien atiende las solicitudes de factura (FC 077). La tienda **no timbra**: la factura se
emite en el sistema externo y aquí se suben sus dos archivos.

## Antes de empezar

El servidor necesita la variable `YEKORA_FISCAL_RFC` (el RFC de la tienda) en la aplicación Node
de `apiv1.yekora.mx` en Hostinger, y redesplegarla después de ponerla. Sin ella toda carga se
rechaza.

## 1. Quién pide la factura

- Quien compró **con cuenta**: desde su pedido, en «Factura» → «Pedir factura». Puede guardar sus
  datos en **Mi información → Datos para factura**.
- Quien compró **como invitado o en mostrador**: tu equipo, en **Administración → Facturación →
  Pedir factura por quien compró sin cuenta**, con el número de pedido y sus datos.

Plazo: 30 días desde el pago. Después de un rechazo o una anulación hay 7 días más. Un pedido
reembolsado por completo no se factura.

## 2. Emitir y subir

1. En **Facturación**, filtro «En espera»: copia RFC, razón social, régimen, código postal, uso y
   el **total a facturar** (ya descuenta devoluciones).
2. Timbra el CFDI 4.0 en el sistema externo.
3. Sube el **PDF** (hasta 2 MB) y el **XML** (hasta 512 KB) en la misma solicitud.

La tienda revisa que el emisor sea la tienda, que el receptor sea el RFC pedido, que el total
coincida (diferencia máxima de $1.00) y que el folio no se haya registrado antes. Al aceptarlos,
envía ambos archivos al correo de la solicitud.

## 3. Rechazar o anular

- **Rechazar** una solicitud en espera cuando los datos no permiten timbrar. Escribe el motivo.
  **No se envía correo**: quien tiene cuenta lo ve en su pedido; a quien no la tiene, avísale.
- **Anular** una factura entregada solo después de cancelarla en el sistema externo. Queda libre
  para una nueva solicitud; el folio anterior no puede volver a usarse.

## Si algo falla

- «Falta configurar el RFC de la tienda»: falta `YEKORA_FISCAL_RFC` o no se redesplegó la API.
- «El RFC del receptor o el total no coincide»: compara el XML con la solicitud; si hubo una
  devolución, timbra por el total a facturar actual.
- Un reembolso parcial hecho solo en el panel del procesador de pagos no se descuenta: revísalo
  antes de timbrar.
