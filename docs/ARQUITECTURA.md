# ARQUITECTURA - SISTEMA HIPICO
> Fase 1 (auditoria + diseno modular). Generado automatico. SHA intacto.
> HEAD == origin/main == cadf4263e5452fd46548f47971025ec0e2330de4

## 1. Monolitos reales (god-files por tamano)
| Archivo | Lineas | Problema |
|---|---|---|
| js/tablas.js | 2563 | UI + negocio + DB + impresion + export |
| js/venta_tablas.js | 1377 | Venta + render + WhatsApp mezclados |
| js/taquilla.js | 885 | Apuestas + resultados + dividendos |
| js/portal.js | 805 | Clientes + tickets + saldos |
| js/clientes.js | 748 | CRUD + saldos + depositos |

## 2. Duplicacion / DRY a resolver
- wa.me: js/whatsapp.js (457) + js/wps.js (302) -> un solo servicio/whatsapp.js
- Formato moneda: monedas/saldos/depositos -> core/utils/formato.js
- Scripts de tooling con solape -> auditar antes de borrar (NO eliminar a ciegas)

## 3. Arbol modular propuesto (capas, en ingles para codigo)
systema_hipico/
|- index.html            (entrada unica, patron actual por hash)
|- src/
   |- core/             (sin DOM - 100% testeable)
      |- db/       repo.js, schema.js   (unica capa supabase)
      |- domain/   tablasFijas.js, apuestas.js, monetaria.js, remates.js
      |- services/ imprimirTablas.js, whatsapp.js, taquilla.js, saldos.js
      |- utils/    formato.js, fecha.js, numero.js
   |- ui/
      |- components/ monitorGrid.js, barraCarrito.js, modalResultado.js, toast.js
      |- pages/     ventaTablas.js, taquilla.js, portal.js  (1 entry por vista)
   |- shared/      constantes.js, tipos.js
|- html/             (solo maquetado, sin logica)
|- css/              (solo estilos compilados)
|- scripts/          (solo tooling real, auditado)
-|-docs/             (esta arquitectura)

## 4. Correspondencia 1:1 dominio -> modulo
- tablas fijas  -> core/domain/tablasFijas.js + ui/components/monitorGrid.js
- impresion    -> core/services/imprimirTablas.js (unifica PDF/JPG/PNG)
- whatsapp     -> core/services/whatsapp.js (unifica wps+whatsapp, 1 wa.me)
- carrito/venta-> ui/components/barraCarrito.js + core/services/ventaTablas.js

## 5. Criterios aplicados
- SOLID: capas separadas, inyeccion de dependencias
- DRY: un solo wa.me, formato, impresion
- KISS: pages/X.js solo engancha components + services
- Migracion incremental: 1 modulo por commit, verificado (SHA + git status)
