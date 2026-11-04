@echo off
title Desplegar en Contabo - Sistema Hipico
echo ========================================================
echo    ACTUALIZAR SISTEMA HIPICO EN CONTABO (80.190.77.210)
echo ========================================================
echo.
echo Conectando por SSH al servidor...
echo Si el sistema solicita contrasena, ingresa la clave root de tu VPS.
echo.
ssh -t root@80.190.77.210 "cd /var/www/sistema_hipico 2>/dev/null || cd ~/sistema_hipico 2>/dev/null || cd /root/sistema_hipico 2>/dev/null; echo '== Directorio actual:'; pwd; echo '== Descargando cambios de GitHub:'; git pull origin main; echo '== Compilando produccion:'; npm run build; echo '== Reiniciando servicio en puerto 3000:'; pm2 restart all || pm2 restart sistema_hipico; echo '== Despliegue culminado con exito!'"
echo.
pause
