@echo off
title Publicar en la Web - Sistema Hipico
echo ========================================================
echo       PUBLICAR SISTEMA HIPICO EN LA WEB
echo ========================================================
echo.
echo 1. Guardando cambios locales...
git add .
git commit -m "update: publicar cambios en la web" 2>nul
echo.
echo 2. Enviando a GitHub (despliegue automatico a GitHub Pages)...
git push origin main
echo.
echo ========================================================
echo  Exito! GitHub Actions ha iniciado la publicacion web.
echo  URL: https://juliocesarosorioc.github.io/sistema_hipico/
echo ========================================================
echo.
pause
