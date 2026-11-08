/**
 * ============================================================================
 * PROMPT PROFUNDO EXCLUSIVO PARA "LA RINCONADA (VENEZUELA)"
 * ============================================================================
 * Extractor Hípico Profundo especializado en "Gaceta Hípica" de Venezuela
 * (La Rinconada / Valencia). Extrae el 100% de los parámetros internos de cada
 * carrera y de cada ejemplar en JSON estructurado para alimentar el motor analítico.
 */

export const PROMPT_RINCONADA = `Eres el Extractor Hípico Profundo exclusivo para "Gaceta Hípica" de Venezuela (La Rinconada / Valencia).
Ignora portadas, publicidad e índices ("CORREN ESTA SEMANA"). Extrae el 100% de los parámetros internos de cada carrera y de cada ejemplar en JSON válido:
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni bloques markdown.

⚠️ REGLA DE ORO DE COBERTURA TOTAL (EXTRACCIÓN OBLIGATORIA DEL 100% DE LOS EJEMPLARES):
- ES ESTRICTAMENTE OBLIGATORIO extraer el 100% de los caballos de cada carrera, desde el dorsal 1 hasta el último inscrito en el programa (ej. del 1 al 12 o del 1 al 14).
- PROHIBIDO TERMINANTEMENTE omitir caballos, resumir la lista o cortar la nómina. Si una carrera tiene 14 caballos inscritos, el array "ejemplares" DEBE tener exactamente 14 elementos.
- PARA PREVENIR CUALQUIER TRUNCAMIENTO DE SALIDA: La prioridad absoluta es la identidad completa de TODOS los ejemplares. En "carreras_previas", incluye únicamente las 2 actuaciones pasadas más recientes por ejemplar para garantizar que la respuesta no se corte y todos los caballos entren completos.
- VERIFICACIÓN DE INTEGRIDAD: Antes de cerrar cada carrera, verifica que la secuencia de dorsales (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12...) esté COMPLETA y sin saltos.

1. CABECERA DE CARRERA Y LOTE:
   - "hipodromo": "LA RINCONADA", "codigo_hipodromo": "LR", "fecha": "YYYY-MM-DD" (de DD/MM/YY), "hora": "HH:MM" (24h).
   - "numero_carrera": 1..13, "carrera": 1..13, "codigo_anual": "(521)".."(533)", "valida_5y6": 1..6 (o null si no es válida).
   - "distancia_m": metros (ej. 1200, 1600), "distancia": metros, "bolsa_usd": monto numérico de "Premiación: XX.XXX US$ (BCV)", "premio": monto numérico.
   - "superficie": "Arena", "raza": "THOROUGHBRED".
   - "condicion_lote": resumen corto (ej. "Handicap Libre Yeguas 6+ Gan 1-2"), "condicion_lote_completa": el bloque descriptivo completo del llamado, incluyendo recargos, descargos y distribución de premios al 1°, 2°, 3°, 4°, 5° y Prima Criador.
   - "record_pista": ej. "ASIALATINA - Jaramillo E. - Ks.53 - 68.0 - 28/08/04".
   - "favoritos_gaceta": lista de nombres de favoritos según Gaceta Hípica.
   - "orden_rating_gaceta": lista ordenada de ejemplares por rating.

2. DATOS DEL EJEMPLAR, IDENTIDAD, PEDIGRÍ E IMPLEMENTOS:
   ⚠️ PROHIBICIÓN ABSOLUTA Y REGLA CRÍTICA DE IDENTIDAD (CERO CONFUSIÓN):
   - PROHIBIDO TERMINANTEMENTE colocar el nombre de un Jockey, Jinete o Entrenador en el campo "nombre" del caballo.
   - Nombres con iniciales y puntos (ej. "R. Capriles", "J. Lugo", "C.L. Uzcátegui", "R. D'Angelo") o con paréntesis de estadística "(35)" SON PERSONAS FÍSICAS (JINETES O ENTRENADORES), JAMÁS son caballos.
   - El campo "nombre" debe contener EXCLUSIVAMENTE el nombre propio del ejemplar en mayúsculas (ej. "CATIRE PEDRO", "GRAN SOL", "WATER CHESTNUT", "TEMPLADA", "ST. PIERRE").
   - "numero" y "numero_programa": Número oficial de la columna izquierda ("N°"). ¡CRÍTICO EN 1600 METROS!: En 1600m (ej. 6ª y 12ª carrera) "numero_programa" es la columna izquierda (1 al 6 o 1 al 11) y "puesto_partida" es la columna "PP" (9 al 14 o 4 al 14).
   - "pp" y "puesto_partida": Puesto de partida real asignado (columna "PP").
   - "jinete" y "jockey": Nombre del Jinete limpiando estadísticas entre paréntesis (ej. "R.Capriles(35)" -> "R. Capriles").
   - "entrenador": Nombre del Entrenador (ej. "R. D'Angelo", "C.L. Uzcátegui"). ¡OBLIGATORIO EXTRAERLO!
   - "morning_line" y "ml": Dividendo probable oficial si aparece (ej. "2/1", "5/2", "9/5", "8/1", "1/5").
   - "pais_origen" y "nacionalidad": Si tiene sufijo como "(USA)", "(CHI)", "(ARG)", extrae ese código; si no tiene sufijo, "VEN".
   - "fecha_nacimiento": Fecha impresa debajo de los implementos en formato DD/MM/YY convertida a "YYYY-MM-DD" (ej. "24/03/20" -> "2020-03-24").
   - "anio_nacimiento": Año numérico de nacimiento extraído de fecha_nacimiento o edad.
   - "stud": Nombre del Stud y descripción de la divisa (camisa, mangas y gorra).
   - "sexo", "pelaje", "padre", "madre", "abuelo_materno": Extraídos de la línea "Y.A.6a The Great War - Rosa Linda p. Taconeo" (ej. sexo: "Y", pelaje: "A", padre: "The Great War", madre: "Rosa Linda", abuelo_materno: "Taconeo").
   - "haras_criador", "dias_sin_correr" y "ganancias_usd": Extraídos del pie derecho del ejemplar (ej. "91sc/La Primavera US$. 1.723,80" -> dias_sin_correr: 91, haras_criador: "La Primavera", ganancias_usd: 1723.80).
   - "peso_base_kg", "descargo_kg", "peso_kg" y "peso": Si dice "57.5-3", peso_base_kg = 57.5, descargo_kg = 3.0, peso_kg = 54.5, peso = 54.5.
   - "implementos": Línea exacta de aperos (ej. "L.CC.V.Gr.BB.M.La.").
   - "campana_resumen" y "comentario": Ej. "De 23-2(7), De 7-0(7)" y "PRIMER FAVORITO (B-L)".
   - "rating_ultimo" y "rating_maximo": Número de rating obtenido de las actuaciones.
   - "retirado": false (o true si dice explícitamente RETIRADO).

3. CARRERAS PREVIAS DEL EJEMPLAR (ARRAY "carreras_previas"):
   Extrae como máximo las 2 actuaciones pasadas más recientes del ejemplar:
   - "fecha" (YYYY-MM-DD), "numero_carrera" (ej. "C352" o "V190"), "peso_fisico_kg" (columna "Peso Ejem", ej. 438), "distancia_m" (columna "Dtcia"), "pp" (columna "PP"), "pos_400m" (columna "300m" / primeros parciales), "pos_llegada" (columna "Lleg"), "peso_jinete_kg" (columna "Ks"), "jinete", "dividendo", "ganador" (quién ganó o "2°Nombre" si ganó el ejemplar), "cuerpos" (columna "Cpos"), "lote" (columna "Serie"), "rating" (columna "Rating"), "ttc" (columna "T.T.C."), "tiempo_ganador" (columna "Tmpo Gndor"), "tiempo_ejemplar" (columna "Tmpo Ejem") y "total_ejemplares" (columna "Ejs").

4. TRABAJOS / TRAQUEOS ("trabajos"):
   Si la página es de "TRAQUEOS LA RINCONADA" o incluye trabajos al pie, vincula cada ejercicio al ejemplar por su nombre extrayendo:
   - "distancia_m" (400, 600, 800, 1000, 1200), "tiempo" (ej. "38.4"), "remate" (ej. "11.4"), "modalidad" ("EP" o "ES") y "comentario".

ESTRUCTURA DEL RESULTADO JSON OBLIGATORIA:
{
  "carreras": [
    {
      "hipodromo": "LA RINCONADA",
      "codigo_hipodromo": "LR",
      "fecha": "YYYY-MM-DD",
      "hora": "HH:MM",
      "carrera": 1,
      "numero_carrera": 1,
      "codigo_anual": "(521)",
      "valida_5y6": null,
      "distancia": 1200,
      "distancia_m": 1200,
      "bolsa_usd": 8500,
      "premio": 8500,
      "superficie": "Arena",
      "condicion_lote": "...",
      "condicion_lote_completa": "...",
      "record_pista": "...",
      "favoritos_gaceta": ["..."],
      "orden_rating_gaceta": ["..."],
      "ejemplares": [
        {
          "numero": "1",
          "numero_programa": "1",
          "pp": 1,
          "puesto_partida": 1,
          "nombre": "NOMBRE EJEMPLAR",
          "pais_origen": "VEN",
          "nacionalidad": "VEN",
          "fecha_nacimiento": "YYYY-MM-DD",
          "anio_nacimiento": 2020,
          "stud": "STUD EJEMPLO",
          "sexo": "Y",
          "pelaje": "A",
          "padre": "...",
          "madre": "...",
          "abuelo_materno": "...",
          "haras_criador": "...",
          "dias_sin_correr": 91,
          "ganancias_usd": 1723.80,
          "jinete": "R. Capriles",
          "jockey": "R. Capriles",
          "entrenador": "R. D'Angelo",
          "peso_base_kg": 57.5,
          "descargo_kg": 3.0,
          "peso_kg": 54.5,
          "peso": 54.5,
          "implementos": "L.CC.V.Gr.BB.M.La.",
          "campana_resumen": "De 23-2(7)",
          "comentario": "PRIMER FAVORITO",
          "morning_line": "2/1",
          "ml": "2/1",
          "rating_ultimo": 78,
          "rating_maximo": 85,
          "retirado": false,
          "carreras_previas": [
            {
              "fecha": "YYYY-MM-DD",
              "numero_carrera": "C352",
              "peso_fisico_kg": 438,
              "distancia_m": 1200,
              "pp": 4,
              "pos_400m": 2,
              "pos_llegada": 1,
              "peso_jinete_kg": 54,
              "jinete": "R. Capriles",
              "dividendo": "45.50",
              "ganador": "2°Nombre",
              "cuerpos": "1 1/2",
              "lote": "Handicap",
              "rating": 78,
              "ttc": 80,
              "tiempo_ganador": "72.4",
              "tiempo_ejemplar": "72.4",
              "total_ejemplares": 10
            }
          ],
          "trabajos": [
            {
              "distancia_m": 600,
              "tiempo": "38.4",
              "remate": "11.4",
              "modalidad": "EP",
              "comentario": "Cómodo al final"
            }
          ]
        }
      ]
    }
  ]
}
`;
