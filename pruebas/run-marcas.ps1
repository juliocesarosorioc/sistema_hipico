#!/usr/bin/env node
# Corre las pruebas de la jerarquia de Marcas.
#
# No hay framework de tests en el repo y no hay tsx/ts-node, asi que se compila
# con el tsc que ya esta instalado y se ejecuta el JS. La logica de Marcas esta
# en un modulo PURO (src/lib/marcas/jerarquia.ts, sin Supabase ni React) justo
# para que esto sea posible sin dependencias nuevas.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$out = Join-Path $env:TEMP "marcas-testbuild"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue

Write-Host "Compilando pruebas..." -ForegroundColor DarkGray
# -p usa pruebas/tsconfig.json (hereda los paths @/* del proyecto). El --outDir
# se pasa por CLI para que la compilacion temporal no quede en el repo.
npx tsc -p pruebas/tsconfig.json --outDir $out
if ($LASTEXITCODE -ne 0) { Write-Host "tsc fallo" -ForegroundColor Red; exit 1 }

  # `cuadros-tabla` cubre el CRUD de cuadros de Tablas Fijas: que la lectura no
  # pierda `ganador`/`ejemplar_id` y que la base de la tabla excluya retirados.
  # `posiciones-llegada` cubre la conversion de la pizarra a la lista de llegadas
  # que se centraliza (que antes se perdia del 2do al 8to en Taquilla).
  # `wps` cubre el motor americano Win/Place/Show: la matriz de dividendos
  # (que el pago depende del tipo apostado Y del puesto alcanzado), que "PP" y
  # "1P" no entren por error, y que una jugada que gana sin dividendo cargado
  # quede PENDIENTE en vez de guardarse como Perdedor con premio 0.
  # `aval-limite` cubre el tope de juego con aval: que el disponible sea
  # `saldo + aval`, que un cliente en mora con aval siga jugando hasta donde le
  # da el aval, que "libre" no tope, y que el reparto autorice de mas si el aval
  # respalda. Es la regla que comparten el navegador y las dos RPC de venta.
  # `caballos-carga` cubre la columna CABALLO de la Taquilla: que solo acepte
  # caballos que corren, que sin lista de participantes admita hasta el 16, y
  # que el tope suba si la carrera cargada muestra mas de 16 caballos.
  # `claves-carreras` cubre la clave de cruce compartida de hipodromo/carrera: que
  # "LA urel", "laurel" y "LAUREL" den la MISMA clave (si no, la misma carrera
  # se ve en un modulo y en otro no), que "PP"/""/negativo no cuelen como numero
  # de carrera, y que el agrupador ordene numericamente (el 10 va tras el 2, no
  # antes) y no invente hipodromos fantasma.
  # `fechas` fija el CONTRATO de fechas: que a la base solo salga ISO, que "04-10-2026"
  # (con guion, como se escribe en Venezuela) se interprete como 4 de octubre, que una
  # fecha ambigua se DECLARE ambigua en vez de resolverse en silencio, y que la
  # validacion falle cerrada. Ese "04-10-2026" mal interpretado fue lo que guardó tres
  # carreras (C10-C12) con fecha 2026-04-10 y partió la jornada del 04-10-2026.
  # `validar-carga` fija la BARRERA de publicacion: una carrera con fecha ilegible,
  # ambigua o de otra jornada no se publica. Sin esto, publicar es escribir en crudo.
  # `remates` cubre la logica pura del modulo de Remates: la derivacion de
  # ejemplares del programa central (numeracion 1..n, retirados fuera de la puja),
  # el motor financiero (subtotal + incentivo - comision) y las probabilidades
  # implicitas del pozo.
  # `hipodromos` fija el catalogo que el CRUD gobierna: que todo hipodromo
  # registrado en estado Activo se vea (ya no hay lista fija VE+USA), que
  # Suspendido/Inactivo salgan de los selectores SIN perder la fila, y que la
  # baja sea logica (eliminado_en) para que al reactivarlo conserve el MISMO id
  # y con el todo lo que ya se registro a su nombre.
  foreach ($t in @("jerarquia-marcas", "carreras-registradas", "liquidacion-marcas", "debutantes-marcas", "cuadros-tabla", "posiciones-llegada", "wps", "aval-limite", "caballos-carga", "claves-carreras", "carreras-maestro", "fechas", "validar-carga", "remates", "hipodromos")) {
    node (Join-Path $out "pruebas/$t.test.js")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  # El SQL se aplica a mano en el SQL Editor (no hay psql ni service_role), asi
  # que antes de cada aplicacion se valida en estatico. Esto no sustituye a
  # ejecutarlo en PostgreSQL, pero atrapa el grant con la firma mal, el parentesis
  # sin cerrar y el reembolso que no deja el ticket en cero.
    Write-Host "`nValidando sql/marcas_venta.sql..." -ForegroundColor DarkGray
    node pruebas/validar-marcas-ddl.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # `sql/carreras.sql` es la matriz MAESTRA: se aplico a mano y fallo con
    # "42804: bigint and uuid are of incompatible types" porque la FK declaraba
    # `hipodromo_id bigint` contra un `hipodromos.id` que es uuid. Al ir todo en
    # una transaccion, ese error se llevo por delante la tabla, el respaldo y
    # los enlaces: no quedo nada instalado. Este validador frapa el tipo
    # equivocado antes de que tenga que repetirlo en produccion.
    Write-Host "`nValidando sql/carreras.sql..." -ForegroundColor DarkGray
    node pruebas/validar-carreras-ddl.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # El script que repara el central (resultados_carreras) a partir de las
    # tablas publicadas. Comprueba, entre otras cosas, que publicar YA sincroniza
    # el central en codigo y que el script no pisa resultados liquidados.
    Write-Host "`nValidando sql/reparar_central_desde_tablas.sql..." -ForegroundColor DarkGray
    node pruebas/validar-central-desde-tablas.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # El trigger que hace la coherencia inevitable: si existe la tabla, existe
    # la fila en el central. Sin el, cada escritor (publicar, editar el Monitor,
    # un script, un PostgREST directo) tiene que acordarse de sincronizar, y el
    # 04-10-2026 demostro que alguno se olvida.
    Write-Host "`nValidando sql/tablas_fijas_sincronizar_central.sql..." -ForegroundColor DarkGray
    node pruebas/validar-trigger-central.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

      # Rutas, permisos y policies. Nada de esto cruza en tiempo de compilacion:
      # un permiso mal escrito no da error de TS, y una ruta olvidada en el
      # `matcher` no es que quede cerrada, es que queda ABIERTA.
      Write-Host "`nValidando RBAC y rutas..." -ForegroundColor DarkGray
      node pruebas/validar-rbac.mjs
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

      # El modulo MAESTRO de seguridad: que el registro de capacidades, la
      # resolucion de accesos (principal > excepcion > base del tipo > denegado)
      # y las puertas de entrada esten de acuerdo. Corre contra el codigo, sin
      # tocar la base.
      Write-Host "`nCoherencia del modulo maestro de seguridad..." -ForegroundColor DarkGray
      node pruebas/maestro-seguridad.test.mjs
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # Coherencia del central contra la base real (solo lectura): toda carrera
    # publicada tiene que existir en `resultados_carreras` con sus ejemplares,
    # que es lo que leen /marcas, /dupleta y Carreras del Dia. Publicar una
    # tabla sin sincronizar el central hacia la jornada invisible ahi.
    Write-Host "`nVerificando coherencia del central..." -ForegroundColor DarkGray
    node pruebas/central-coherente.test.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # La auditoria de jornadas mira los DATOS, no el codigo, porque el daño del
    # 04-10-2026 ya estaba en la base: C10-C12 guardadas como 2026-04-10 (dia
    # partido) y C1-C9 publicadas sin fila en el central. Ademas de la coherencia
    # del central, busca el dia partido (la huella de DD-MM vs MM-DD), los huecos
    # de 3+ carreras dentro de una jornada y las fechas en crudo. Sale 1 si hay
    # algo, asi que frena el runner: primero se arregla la base, despues se sigue.
    #
    # Va ANTES de auditar-base-maestro a proposito: ese falla mientras el seed del
    # maestro no este aplicado, y si fuera primero taparia estos hallazgos (que ya
    # pasaron una vez y por eso existe esta auditoria).
    Write-Host "`nAuditando las jornadas contra la base real..." -ForegroundColor DarkGray
    node pruebas/auditar-jornadas.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # Que el maestro exista de verdad en la base y coincida con el registro del
    # codigo: capacidades, matriz por tipo y el usuario principal. Esto NO lo
    # cubre ninguna otra prueba, y es la diferencia entre "el codigo esta bien"
    # y "el sistema funciona": sin aplicar el SQL, el login entra y no ve nada.
    # Solo lee.
    Write-Host "`nAuditando el maestro contra la base real..." -ForegroundColor DarkGray
    node pruebas/auditar-base-maestro.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # Credenciales exposed. Busca columnas de password/secrets en todas las
    # tablas que toca la app y avisa si son legibles con la llave anon. Se
    # encontro `operadores.password` con las contrasenas del negocio en texto
    # plano; mientras esas filas no se roten, esto falla a proposito.
    Write-Host "`nAuditando credenciales expuestas..." -ForegroundColor DarkGray
    node pruebas/auditar-credenciales.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # La E2E pega contra la base real. Crea un cliente sintetico, dos carreras
    # sinteticas y sus tickets, y los borra al terminar. Es la unica prueba que
    # de verdad mueve plata, asi que va al final: si algo anterior falla, mejor
    # no tocar la base.
    if ($args -contains "--sin-e2e") {
        Write-Host "`nSaltando la E2E (--sin-e2e)" -ForegroundColor DarkGray
    } else {
        Write-Host "`nCorriendo la E2E contra la base real..." -ForegroundColor DarkGray
        node pruebas/e2e-marcas.mjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        # Debutantes y snapshot de configuracion, en su propio script porque
        # tienen su propio cliente sintetico. Si la base no tiene las columnas
        # todavia, este dice exactamente que SQL falta y para.
        Write-Host "`nCorriendo la E2E de debutantes..." -ForegroundColor DarkGray
        node pruebas/e2e-debutantes.mjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    exit 0
