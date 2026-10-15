# Guía — WhatsApp Business Cloud API (envíos al grupo)

Guía paso a paso para que la plataforma pueda **mandar reportes y pizarras a un
grupo de WhatsApp** usando la API oficial de Meta (WhatsApp Business Cloud API).

Hay tres piezas que se conectan:

```
Meta (Cloud API)  ──webhook──▶  Edge Function whatsapp-webhook  ──▶ whatsapp_grupos (detecta el group_id)
Centro WhatsApp   ──POST─────▶  Edge Function whatsapp-grupos   ──▶ vincular / renombrar / automatizaciones
Centro WhatsApp   ──POST─────▶  Edge Function whatsapp-enviar   ──▶ POST graph.facebook.com  ──▶ grupo
```

- **Detectar el grupo:** el número del negocio se agrega a un grupo; cuando
  alguien escribe, Meta avisa por webhook y `whatsapp-webhook` guarda el
  `group_id`. Ese id es lo único que la API acepta como destino de un mensaje
  de grupo.
- **Enviar:** `whatsapp-enviar` manda el texto con `recipient_type:"group"`.
  Manual desde el Centro WhatsApp, o automático si el toggle del módulo está
  activo (hoy: cierre de remate).

> ⚠️ **Requisito previo (SQL y deploy son manuales, no están en el repo).**
> Antes de configurar Meta, o en paralelo:
>
> 1. Aplicar `sql/whatsapp_integracion.sql` en el SQL Editor de Supabase
>    (crea `whatsapp_grupos`, `whatsapp_envios`, `whatsapp_automatizaciones`
>    con RLS y el seed de los 4 toggles apagados).
> 2. Re-aplicar `src/db/maestro_seed.sql` (idempotente) para que existan las
>    capacidades `whatsapp:vincular_grupo` (admin) y `whatsapp:enviar_grupo`
>    (admin + consulta).

---

## Paso 1 — Cuenta de desarrollador de Meta

1. Entrá a <https://developers.facebook.com> y creá una cuenta con el correo
   del negocio (o la de Facebook personal del dueño; el registro de negocio
   va después).
2. En **Registro de negocios** (Business Settings) confirmá el **negocio**
   (`business.facebook.com/settings` → *Business info*): nombre, país, correo
   de contacto. Sin un negocio verificado no se puede crear una app de
   WhatsApp.

## Paso 2 — Crear la aplicación

1. En <https://developers.facebook.com/apps> → **Create App**.
2. Tipo: **Business**.
3. Nombre: por ejemplo `sistema-hipico-whatsapp`.
4. Al terminar, la app queda en modo *development*. Eso alcanza para probar
   con hasta **5 números de prueba**; para el número real hace falta el modo
   *live* (Paso 6, abajo).

## Paso 3 — WhatsApp > API Setup (WABA y número)

Dentro de la app, panel izquierdo: **WhatsApp ▸ API Setup** (o
**WhatsApp ▸ Getting Started**):

1. Si no existe, creá la **WABA** (WhatsApp Business Account). Se puede
   hacer desde el propio asistente ("Create a business account") o desde
   Business Settings ▸ WhatsApp accounts.
2. Con la WABA creada, elegí el **phone number**:
   - Para pruebas: **Add phone number** → "Use a test number" (te da un
     número virtual y no pide documento).
   - Para el número real del negocio: **Add phone number** → registrá el
     número existente con el PIN de verificación por SMS/llamada. Este es el
     camino final; el número real se agrega **agregándolo al grupo**.
3. Anotá el **Phone Number ID** (número largo, ej. `123456789012345`) y el
   **Business Account ID** (WABA ID). Son distintos: el Phone Number ID
   identifica el número; la WABA agrupa números, plantillas y proveedores.

> El número real exige verificar el negocio (Business Verification) para
> salir de modo *development* y poder mandar mensajes al número real. El
> número de prueba no lo exige.

## Paso 4 — Token de acceso (Access Token)

En **API Setup**, sección *Access Tokens*:

1. **Temporary token**: sirve para probar (dura ~24 h). Feliz para el primer
   ensayo; para producción se recomienda un **token permanente**:
2. **Permanent token** (recomendado, no expira):
   - Abrí <https://developers.facebook.com/tools/explorer>.
   - App = la creada en el Paso 2. Pedí los permisos
     `whatsapp_business_messaging` y `whatsapp_business_management`.
   - Generá el token y, con la app en modo *live*, **intercambialo por uno de
     larga duración** en *API Setup* (botón **Manage** / *System User*):
     - Business Settings ▸ **System users** (o *Integrations*) → creá un
       usuario del sistema con el rol *Admin* de la app/negocio.
     - En ese system user: **Generate token** → elegí la app y los permisos
       de WhatsApp. El token de un system user es **permanente**.
   - Copialo con cuidado: solo se muestra una vez.

> 🔐 **No pegar el token en el repo.** Vive como secreto de Supabase
> (Paso 5). La anon key del bundle del sitio nunca lo conoce.

## Paso 5 — Secretos en Supabase

En la raíz del repo (o con la CLI en cualquier carpeta):

```bash
npx supabase secrets set \
  WHATSAPP_ACCESS_TOKEN="EAA..." \
  WHATSAPP_PHONE_NUMBER_ID="123456789012345" \
  WHATSAPP_VERIFY_TOKEN="un-secreto-largo-que-solo-conoces-tu"
```

- `WHATSAPP_ACCESS_TOKEN` — el token del Paso 4 (permanente para producción).
- `WHATSAPP_PHONE_NUMBER_ID` — el id del número del Paso 3.
- `WHATSAPP_VERIFY_TOKEN` — frase secreta tuya; Meta la repite en la
  verificación del webhook (Paso 7). **Definila antes de conectar el webhook.**

Verificá que quedaron:

```bash
npx supabase secrets list
```

## Paso 6 — Desplegar las Edge Functions

```bash
npx supabase functions deploy whatsapp-webhook
npx supabase functions deploy whatsapp-grupos
npx supabase functions deploy whatsapp-enviar
```

La **URL base** de las funciones es
`https://<REF>.supabase.co/functions/v1/` — `<REF>` es el subdominio del
proyecto que figura en Dashboard ▸ *Project Settings ▸ API*. La vas a usar
en el Paso 7 (solo la parte del webhook).

> Las tres dependen de `jsr:@supabase/supabase-js@2` (Deno), igual que
> `portal-auth`. No hacen falta imports locales.

## Paso 7 — Conectar el webhook en Meta

1. En **API Setup**, sección *Webhook* → **Edit** (o **Configure**):
   - **Callback URL**:
     `https://<REF>.supabase.co/functions/v1/whatsapp-webhook`
   - **Verify token**: el `WHATSAPP_VERIFY_TOKEN` del Paso 5.
   - **Verify and save**. Si da error, revisá que el secreto esté puesto y la
     función `whatsapp-webhook` desplegada (el GET de verificación responde
     solo si el token coincide).
2. **Suscribir el field `messages`**: en la misma sección, abajo de
   *Webhook fields*, elegí **messages** (y si la cuenta llegara a tener OBA,
   los `group_*`) → **Subscribe**. Sin la suscripción a `messages`, un
   mensaje en el grupo no dispara nada.
3. El PUT/Marcar como **verificado** a veces pide re-entrar a la app en modo
   *live*: *App Review* no es necesario para WhatsApp Cloud API (a diferencia
   de otras APIs de Meta), solo la verificación del negocio para el número
   real.

## Paso 8 — Verificar la app en modo live (número real)

Para mandar mensajes al número real de WhatsApp (no de prueba):

- **Business Verification** en Business Settings (requiere web del negocio,
  documento y a veces llamada).
- WhatsApp Manager ▸ el número ▸ **Activate/review**.
- Empezar una conversación con el número desde WhatsApp (mandarle un mensaje
  desde el teléfono) para que Meta lo valide como *unregistered*.

El número de prueba salta este paso.

## Paso 9 — Probar la integración completa

1. **Sanidad:** abrí el Centro WhatsApp. Si todo está en su lugar, arriba
   aparece el panel **Conexión al grupo de WhatsApp** en verde, sin el aviso
   amarillo "Integración no configurada".
2. **Detectar el grupo:** en tu WhatsApp, agregá el número del negocio a un
   grupo (si es número de prueba, se agrega desde WhatsApp Web con ese
   número) y escribí cualquier mensaje en el grupo.
3. En el Centro WhatsApp → **⟳ Verificar**: el grupo aparece en *Grupos
   detectados* con su fecha. Si no aparece, revisá el Paso 7 (field
   `messages` suscrito) o el log de la función `whatsapp-webhook`.
4. **Vincular:** tocá **Vincular** en ese grupo (y opcionalmente **✏️** para
   ponerle nombre). Queda como *Grupo vinculado*.
5. **Enviar:** en la pestaña de *Reporte*, generá el reporte y tocá
   **📤 Enviar al grupo**. El mensaje llega al grupo. En **Historial** queda
   el registro, y la bitácora técnica en `whatsapp_envios`.
6. **Automático (opcional):** en el panel, activá **Cierre / pizarra de
   remate**. La próxima vez que se copie la pizarra de un remate
   (`copiarPizarra`), se manda sola al grupo vinculado.

---

## Límites y limitaciones que hay que conocer

| Límite | Qué implica |
| --- | --- |
| **Ventana de servicio de 24 h** | Texto libre solo mientras el grupo (o el número) te haya escrito en las últimas 24 h. Fuera de la ventana, la API rechaza y pide una **plantilla aprobada**. Para una casa que escribe a horas fijas, conviene que alguien del grupo escriba (o usar plantillas). |
| **Plantillas** | Mensajes pre-aprobados para fuera de la ventana. Se crean en WhatsApp Manager ▸ Message templates. Hoy la integración manda texto libre; si querés plantillas, hay que extender `whatsapp-enviar` con `type:"template"`, `name` y `language`. |
| **Conversación** | Meta cobra por **conversación de servicio** (24 h) o por plantilla enviada. Un mensaje al grupo abre 1 conversación de servicio; los mensajes del grupo hacia el negocio no se cobran. Consultá la tarifa vigente del país del número. |
| **`group_id` sin nombre** | El webhook de `messages` no trae el subject del grupo: el nombre lo pone el usuario en la UI (✏️). |
| **Listado de grupos por API** | `GET /<Phone-Number-ID>/groups` existe pero exige OBA (On-Behalf-Of, para BSPs) y límites de 8 participantes en grupos creados por API. No se usa: la detección es por webhook. |
| **Versión de la API** | La función usa `graph.facebook.com/v21.0`. Si Meta depreca esa versión, se actualiza la constante `GRAPH` en `supabase/functions/whatsapp-enviar/index.ts` y se redeploya. |
| **Número de prueba** | No aparece en el WhatsApp real del celular; se usa desde WhatsApp Web/Desktop con la sesión del número de prueba, y los usuarios de prueba se definen en API Setup. |

## Solución de problemas

| Síntoma | Causa más probable | Qué hacer |
| --- | --- | --- |
| "Integración no configurada" en el panel | Faltan secretos o funciones desplegadas | Paso 5 y 6; `npx supabase secrets list` |
| El grupo no aparece como detectado | Field `messages` no suscrito, o nadie escribió en el grupo | Paso 7.2; escribir un mensaje en el grupo |
| 403 al verificar el webhook | `WHATSAPP_VERIFY_TOKEN` distinto entre Meta y Supabase | Revisar el secreto y el token de verificación en API Setup |
| "No hay grupo vinculado" al enviar | Falta el Paso 9.4 (Vincular) | Vincular en el panel |
| Meta responde `(#131030) Current message is outside the 24-hour window` | Ventana de servicio cerrada | Que alguien del grupo escriba, o pasar a plantillas |
| `(#100) ... approval required` | App o número sin el permiso completo / sin verificación de negocio | Paso 8 (modo live + verificación) |
| `(#200) Access token has expired` | Token temporal vencido | Generar el token permanente del system user (Paso 4) |
| El envío automático no dispara | Toggle apagado, grupo sin vincular, o sin red | Revisar panel, toggle y `whatsapp_envios` |

## Referencias

- <https://developers.facebook.com/docs/whatsapp/cloud-api>
- <https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples>
- <https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages>