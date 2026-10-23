import { redirect } from "next/navigation";

/**
 * `/dashboard` es un alias ANTIGUO del escritorio. La pantalla real vive en
 * `/inicio`, dentro del grupo de rutas `(dashboard)` (la única fuente de verdad
 * del App Router: `src/app/dashboard/` se eliminó porque duplicaba esa ruta y
 * provocaba colisión).
 *
 * Este archivo NO es una segunda pantalla: es un puente. Sin él, cualquier
 * enlace viejo, marcador o pestaña guardada en `/dashboard` caería en un 404,
 * y `primeraRutaPermitida()` —que devuelve la PRIMERA ruta registrada que el
 * usuario puede abrir— mandaría al operador a un callejón sin salida.
 *
 * El redireccionamento es del lado del SERVIDOR (`redirect()`), no un
 * `useEffect` en el cliente: así funciona igual en el build estático de
 * GitHub Pages, donde el middleware de Next no existe.
 */
export default function DashboardAliasPage() {
  redirect("/inicio");
}
