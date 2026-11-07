/**
 * ============================================================================
 * PROMPT PROFUNDO EXCLUSIVO PARA "AMERICANAS (EE. UU.)"
 * ============================================================================
 * Extractor Hípico Profundo especializado en retrospectos de Estados Unidos
 * (BEL, CD, CT, DED, DMR, EVD, FL, GP, IND, LRL, LS, MNR, MVR, PEN, PRX, RP, SAR, AQU, GP, WO, etc.).
 * Limpia la marca de agua recurrente "RETRO HIPICO 0414 9132896" y procesa
 * las coordenadas espaciales (Y, X) para reconstruir columnas de izquierda a derecha.
 */

export const MARCA_AGUA_RETRO_HIPICO_REGEX = /RETRO\s*H[ÍI]PICO\s*0?414\s*9132896/gi;

/**
 * Limpia la marca de agua recurrente de los retrospectos americanos
 */
export function limpiarMarcaAguaRetrospecto(texto: string): string {
  if (!texto) return "";
  return texto.replace(MARCA_AGUA_RETRO_HIPICO_REGEX, "").trim();
}

export const PROMPT_AMERICANAS = `Eres el Extractor Hípico Profundo exclusivo para retrospectos de Estados Unidos (BEL, CD, CT, DED, DMR, EVD, FL, GP, IND, LRL, LS, MNR, MVR, PEN, PRX, RP, SAR).
El texto ha sido ordenado espacialmente por coordenadas (Y, X) de pdfjs-dist y se ha removido la marca de agua "RETRO HIPICO 0414 9132896".
Extrae el 100% de los parámetros internos de cada carrera y de cada ejemplar en JSON válido:

1. CABECERA DE CARRERA Y CARACTERÍSTICAS DEL LOTE:
   - "hipodromo", "codigo_hipodromo", "fecha" (YYYY-MM-DD), "hora" (24h), "numero_carrera", "distancia_m".
   - "superficie": Prioriza el recuadro superior ("Arena", "Grama", "Tapeta").
   - "raza": "QUARTER HORSE" o "THOROUGHBRED".
   - "bolsa_usd": Monto de "Purse XX.XXX".
   - "condicion_lote": Código corto (ej. "Clm 16000b", "OClm 50000n1x").
   - "condicion_lote_completa": Línea técnica completa después de Purse (ej. "Purse 24.000 TCENTRIES 1ST LRL NOVEMBER 6 5.5F ... CLAIMING 16000-12500 Para Ejemplares de 3 y mas años").

2. IDENTIDAD DEL EJEMPLAR, PEDIGRÍ, STUD, JINETE, PESO Y DÍAS SIN CORRER:
   - Reconstruye cualquier nombre o Morning Line desplazado al pie de página emparejándolo con su fila superior.
   - "numero_programa": Número o llave en la columna izquierda ("1", "1A", "2"...).
   - "puesto_partida": Columna "PP" entera.
   - "nombre" y "pais_origen": Si el nombre incluye sufijo "(IRE)", "(GB)", "(FR)", "(BRZ)", "(CHI)", "(MEX)", extráelo en "pais_origen"; si no tiene sufijo, "pais_origen": "USA".
   - "stud": Nombre completo después de "Stud:".
   - "sexo", "pelaje", "anio_nacimiento", "padre", "madre", "abuelo_materno": De la línea de pedigrí (ej. "CZ3a-Candy Ride en Sauvecito p. Cairo Prince" -> sexo: "C", pelaje: "Z", edad: 3 años -> anio_nacimiento = anio_carrera - 3, padre: "Candy Ride", madre: "Sauvecito", abuelo_materno: "Cairo Prince").
   - "jinete", "peso_kg" (convirtiendo coma a punto, ej. 55.3), "entrenador": Tomados exclusivamente de la columna "Jin/Kgs/Ent" de HOY.
   - "dias_sin_correr": Entero extraído de "XXd S/C" (ej. "36d S/C" -> 36; "0d S/C" -> 0).
   - "campana_resumen" y "ganancias_usd": De "Act: (12-2-1-4) $62.739".
   - "es_elegible": true si tiene marca "AE" o "MTO" (fusionando páginas de continuación del mismo número de carrera).
   - "morning_line": ej. "5/2", "8/1", etc.

3. CARRERAS PREVIAS DEL EJEMPLAR (ARRAY "carreras_previas"):
   Por cada fila del historial ("Fec Hip Dist PP 1 2 Ll Kgs Jin/Div Ganador Cps Lote Rat TG TE"), extrae:
   - "fecha": Convierte "DD/MM" al año correspondiente en formato "YYYY-MM-DD".
   - "hipodromo" y "numero_carrera": Separa las letras del código de pista y el número de carrera pegado (ej. "21/08 Elp9" -> hipodromo: "ELP", numero_carrera: "9"; "10/10 SA1" -> hipodromo: "SA", numero_carrera: "1").
   - "distancia_m": Columna "Dist" (ej. 1100, 1200, 1600, o 228/300/318 en Quarter Horse).
   - "pp": Columna "PP" de esa carrera previa.
   - "pos_400m": Columna "1" (posición de recorrido en los primeros 400 metros, justo después de PP).
   - "pos_800m": Columna "2" (posición de recorrido en los 800 metros, después de la columna 1).
   - "pos_llegada": Columna "Ll" (posición final de llegada).
   - "peso_jinete_kg": Columna "Kgs" convertida a punto decimal (ej. 55.8).
   - "jinete" y "dividendo": Separa de "Jin/Div" el nombre del jinete previo y el dividendo separado por coma (ej. "J.L. Ortiz, 6,80" -> jinete: "J.L. Ortiz", dividendo: "6.80").
   - "ganador": Columna "Ganador" (quién ganó esa carrera, o "2°Nombre" si el ejemplar ganó).
   - "cuerpos": Columna "Cps" (ej. "4 3/4", "Pcz", "Cbz", "Nrz").
   - "lote": Columna "Lote" (ej. "Clm16000n2l", "MdSpWt100k").
   - "rating": Columna "Rat" entera.
   - "tiempo_ganador": Columna "TG" (ej. "69.2", "96.1").
   - "tiempo_ejemplar": Columna "TE" (ej. "70.3", o "Ganó" si triunfó).

4. TRABAJOS / BRISEOS AL PIE DEL EJEMPLAR (ARRAY "trabajos"):
   Extrae cada trabajo con formato "hXd, DIST en TIEMPO [Voló]-SUP-EST (RANK)-HIP" (ej. "h7d, 800 en 49-Are-Rap (4/11)-ELP"):
   - "dias_atras": 7, "distancia_m": 800, "tiempo": "49.0", "superficie_estado": "Are-Rap", "ranking": "4/11", "hipodromo": "ELP", "comentario": "Voló" (si aparece).

ESTRUCTURA DEL RESULTADO JSON OBLIGATORIA:
{
  "carreras": [
    {
      "hipodromo": "GULFSTREAM PARK",
      "codigo_hipodromo": "GP",
      "fecha": "YYYY-MM-DD",
      "hora": "14:15",
      "numero_carrera": 1,
      "distancia_m": 1200,
      "superficie": "Arena",
      "raza": "THOROUGHBRED",
      "bolsa_usd": 32000,
      "condicion_lote": "Clm 16000b",
      "condicion_lote_completa": "Purse 32.000 CLAIMING 16000-12500 ...",
      "ejemplares": [
        {
          "numero_programa": "1",
          "puesto_partida": 1,
          "nombre": "AMERICAN EXAMPLE",
          "pais_origen": "USA",
          "anio_nacimiento": 2021,
          "stud": "FLYING RACING STABLE",
          "sexo": "M",
          "pelaje": "Z",
          "padre": "Into Mischief",
          "madre": "Starlet",
          "abuelo_materno": "Empire Maker",
          "dias_sin_correr": 35,
          "ganancias_usd": 45200,
          "jinete": "I. Ortiz Jr.",
          "entrenador": "T. Pletcher",
          "peso_kg": 54.4,
          "es_elegible": false,
          "campana_resumen": "Act: (10-2-1-3) $45.200",
          "morning_line": "5/2",
          "carreras_previas": [
            {
              "fecha": "YYYY-MM-DD",
              "hipodromo": "GP",
              "numero_carrera": "3",
              "distancia_m": 1200,
              "pp": 2,
              "pos_400m": 1,
              "pos_800m": 1,
              "pos_llegada": 2,
              "peso_jinete_kg": 54.4,
              "jinete": "I. Ortiz Jr.",
              "dividendo": "3.40",
              "ganador": "Fast Runner",
              "cuerpos": "1/2",
              "lote": "Clm 20000",
              "rating": 84,
              "tiempo_ganador": "70.4",
              "tiempo_ejemplar": "70.5"
            }
          ],
          "trabajos": [
            {
              "dias_atras": 7,
              "distancia_m": 800,
              "tiempo": "49.0",
              "superficie_estado": "Are-Rap",
              "ranking": "4/11",
              "hipodromo": "ELP",
              "comentario": "Voló"
            }
          ]
        }
      ]
    }
  ]
}
`;
