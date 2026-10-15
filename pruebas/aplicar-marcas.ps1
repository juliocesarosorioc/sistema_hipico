#!/usr/bin/env pwsh
# ============================================================================
# Pone el SQL de Marcas en el portapapeles, en el orden correcto, para pegar
# en el SQL Editor de Supabase.
#
# Por que existe: este proyecto no tiene `service_role`, ni psql, ni Supabase
# CLI, ni Docker. La unica credencial es la anon key, que NO puede crear
# funciones ni tablas. La unica via es pegar el SQL a mano en el navegador, y
# son dos archivos que van EN ORDEN: el seed usa la tabla que crea el primero.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File pruebas\aplicar-marcas.ps1
#   (con -Stage para pegar solo el primero y despues el segundo)
# ============================================================================
param(
  [ValidateSet("ambos", "1", "2", "3")]
  [string]$Stage = "ambos"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$archivos = switch ($Stage) {
  "1" { @("sql/marcas_venta.sql") }
  "2" { @("sql/marcas_seed_grupos.sql") }
  "3" { @("sql/grupos_venta_lectura.sql") }
  default { @("sql/marcas_venta.sql", "sql/marcas_seed_grupos.sql", "sql/grupos_venta_lectura.sql") }
}

# El validador corre ANTES de copiar nada: si el SQL tiene un grant con la firma
# mal, pegarlo en el SQL Editor revienta en mitad y deja la migracion a medias.
Write-Host "Validando antes de copiar..." -ForegroundColor DarkGray
node pruebas/validar-marcas-ddl.mjs
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n  El SQL no esta listo. No se copio nada al portapapeles." -ForegroundColor Red
  exit 1
}

$todo = ($archivos | ForEach-Object {
  "`n-- ============================================================`n" +
  "-- $($_.Replace('\','/'))`n" +
  "-- ============================================================`n" +
  (Get-Content $_ -Raw -Encoding UTF8)
}) -join "`n"

Set-Clipboard -Value $todo

$lineas = ($todo -split "`n").Count
Write-Host ""
Write-Host "  Copiado al portapapeles: $lineas lineas" -ForegroundColor Green
Write-Host ""
Write-Host "  Que hacer ahora:" -ForegroundColor White
Write-Host "    1) Abre https://supabase.com/dashboard -> tu proyecto -> SQL Editor"
Write-Host "    2) Nueva consulta, pega (Ctrl+V) y dale Run."
Write-Host ""
if ($Stage -eq "1" -or $Stage -eq "ambos") {
  Write-Host "    Ojo: el primer archivo va solo. sql/marcas_seed_grupos.sql" -ForegroundColor Yellow
  Write-Host "    depende de la tabla marcas_carrera, asi que pegalo DESPUES." -ForegroundColor Yellow
  Write-Host "    Si te pegaste los dos juntos y fallo, aplica:" -ForegroundColor DarkYellow
  Write-Host "      sql/marcas_venta.sql  (solito)" -ForegroundColor DarkYellow
  Write-Host "    despues:" -ForegroundColor DarkYellow
  Write-Host "      powershell -NoProfile -ExecutionPolicy Bypass -File pruebas\aplicar-marcas.ps1 -Stage 2" -ForegroundColor DarkYellow
  Write-Host "    y al final:" -ForegroundColor DarkYellow
  Write-Host "      node pruebas/e2e-marcas.mjs" -ForegroundColor DarkYellow
  Write-Host "      node pruebas/e2e-debutantes.mjs" -ForegroundColor DarkYellow
} else {
  Write-Host "    3) Corre:  node pruebas\e2e-marcas.mjs" -ForegroundColor Green
  Write-Host "               node pruebas\e2e-debutantes.mjs" -ForegroundColor Green
}
Write-Host ""
