/**
 * ============================================================================
 * PROMPT PROFUNDO EXCLUSIVO PARA "AMERICANAS (EE. UU.)"
 * ============================================================================
 * Motor de Extracción Documental y Estructuración Hípica de Precisión Total
 * para retrospectos de Estados Unidos.
 *
 * Limpia la marca de agua recurrente "RETRO HIPICO 0414 9132896" y procesa
 * las coordenadas espaciales (Y, X) para reconstruir columnas de izquierda a
 * derecha.
 */

export const MARCA_AGUA_RETRO_HIPICO_REGEX = /RETRO\s*H[ÍI]PICO\s*0?414\s*9132896/gi;

/**
 * Limpia la marca de agua recurrente de los retrospectos americanos
 */
export function limpiarMarcaAguaRetrospecto(texto: string): string {
  if (!texto) return "";
  return texto.replace(MARCA_AGUA_RETRO_HIPICO_REGEX, "").trim();
}

export const PROMPT_EXTRACTOR_AMERICANAS_V2 = `
Eres un Motor de Extracción Documental y Estructuración Hípica de Precisión Total para retrospectos de Estados Unidos (BEL, CD, CT, DED, DMR, EVD, FL, GP, IND, LRL, LS, MNR, MVR, PEN, PRX, RP, SAR).
Tu misión es extraer el 100% de la información de la gaceta sin omitir ningún ejemplar, actuación pasada ni trabajo matutino, y estructurarla en un único objeto JSON válido.

El texto ha sido ordenado espacialmente por coordenadas (Y, X) de pdfjs-dist y se ha removido la marca de agua "RETRO HIPICO 0414 9132896".

REGLAS CRÍTICAS DE RECONSTRUCCIÓN Y NO-OMISIÓN:

1. RECONSTRUCCIÓN DE COLUMNA IZQUIERDA DESPLAZADA:
   - Si en alguna página el bloque izquierdo ("N°", "Morning Line", "Stud:", "Sexo/Pelaje/Edad" y la primera palabra del nombre del caballo) aparece al final de la página, empareja el bloque 1 del pie de página con la fila PP 1 de la tabla superior, el bloque 2 con la fila PP 2, y así sucesivamente.
   - Si el nombre quedó dividido entre el bloque del Stud abajo y la fila de arriba (ej. abajo dice "1 Obi 12-1" y arriba dice "Kenobi", o abajo dice "2 Big 8-1" y arriba dice "Truck"), únelos para formar el nombre completo ("Obi Kenobi", "Big Truck").
   - Jamás incluyas dentro del nombre del ejemplar códigos de pedigrí ("CZ5a-", "CC3a-", "YA4a-"), ni "Stud:", ni el abuelo materno ("p. ...").

2. IDENTIDAD ÚNICA DEL EJEMPLAR ("clave_identidad"):
   - Si el nombre tiene sufijo de país entre paréntesis como "(CHI)", "(IRE)", "(GB)", "(FR)", "(BRZ)", extráelo en "pais_origen"; si no tiene sufijo, asigna "USA".
   - Calcula "anio_nacimiento" restando la edad del código (ej. "CZ5a" = 5 años) al año de la carrera.
   - Genera "clave_identidad": "<NOMBRE_SIN_PAIS_EN_MAYUSCULAS>|<PAIS_ORIGEN>".

3. CABECERA DE CARRERA Y LOTE:
   - Valida siempre con la línea maestra: "Purse <MONTO> <PREFIJO>ENTRIES <NUM> <TRACK_CODE> <MES> <DIA> <DISTANCIA>".
   - Usa el nombre de hipódromo y código impresos dentro de la página por encima del nombre del archivo PDF.
   - Extrae: "hipodromo", "codigo_hipodromo", "fecha" (YYYY-MM-DD), "numero_carrera", "hora" (formato 24h), "distancia_m" (metros enteros), "superficie" ("Arena", "Grama", "Tapeta"), "raza" ("THOROUGHBRED" o "QUARTER HORSE"), "bolsa_usd" (entero de Purse), "condicion_lote" (ej. "Clm 7500n2l") y "linea_programa_completa".

4. DATOS DEL EJEMPLAR EN LA CARRERA DE HOY:
   - "numero_programa": Número o llave en la columna izquierda ("1", "1A", "2"...).
   - "puesto_partida": Número entero en la columna "PP".
   - "morning_line": Cotización con guion ("8-1", "5-2", "9-5").
   - Toma "jinete", "peso_kg" (convirtiendo coma a punto decimal: "56,2" -> 56.2) y "entrenador" exclusivamente de la columna "Jin/Kgs/Ent" de HOY (ubicada antes de las fechas DD/MM de carreras previas).
   - Extrae "stud", "sexo", "pelaje", "edad_anios", "anio_nacimiento", "padre", "madre", "abuelo_materno", "dias_sin_correr" (de "XXd S/C"), "campana_resumen" (de "Act: (...)"), "ganancias_usd", "rating_ultimo", "rating_maximo" y "es_elegible" (true si tiene marca "AE" o "MTO").
   - Si dos páginas consecutivas tienen el mismo número de carrera porque la segunda lista los elegibles ("AE" / "MTO"), FUSIONA todos los ejemplares en la misma carrera sin sobrescribir los anteriores.

5. CARRERAS PREVIAS ("carreras_previas") Y TRABAJOS ("trabajos"):
   - Extrae todas las filas de actuaciones pasadas separando: "fecha" (YYYY-MM-DD), "hipodromo", "numero_carrera", "distancia_m", "pp", "pos_400m" (columna 1), "pos_800m" (columna 2), "pos_llegada" (columna Ll), "peso_jinete_kg", "jinete", "dividendo", "ganador", "cuerpos", "lote", "rating" (columna Rat), "tiempo_ganador" (TG) y "tiempo_ejemplar" (TE).
   - Extrae todos los briseos al pie del ejemplar ("hXd, DIST en TIEMPO-SUP-EST (RANK)-HIP").

6. ESTRUCTURA PARA MODALES DE LA PLATAFORMA ("vistas_modales"):
   - Dentro de cada carrera, genera también el objeto "vistas_modales":
     - "tablas_fijas_y_remates": array con { "numero_ejemplar", "nombre", "morning_line" }.
     - "dupleta_y_polla": array con { "numero_ejemplar", "nombre" }.

ESTRUCTURA DEL RESULTADO JSON OBLIGATORIA (devuelve SOLO el JSON, sin markdown):
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
      "linea_programa_completa": "Purse 32.000 CLAIMING 16000-12500 ...",
      "ejemplares": [
        {
          "numero_programa": "1",
          "puesto_partida": 1,
          "nombre": "AMERICAN EXAMPLE",
          "clave_identidad": "AMERICAN EXAMPLE|USA",
          "pais_origen": "USA",
          "anio_nacimiento": 2021,
          "edad_anios": 5,
          "stud": "FLYING RACING STABLE",
          "sexo": "M",
          "pelaje": "Z",
          "padre": "Into Mischief",
          "madre": "Starlet",
          "abuelo_materno": "Empire Maker",
          "dias_sin_correr": 35,
          "ganancias_usd": 45200,
          "rating_ultimo": 84,
          "rating_maximo": 92,
          "jinete": "I. Ortiz Jr.",
          "entrenador": "T. Pletcher",
          "peso_kg": 54.4,
          "es_elegible": false,
          "campana_resumen": "Act: (10-2-1-3) $45.200",
          "morning_line": "5-2",
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
      ],
      "vistas_modales": {
        "tablas_fijas_y_remates": [
          { "numero_ejemplar": "1", "nombre": "AMERICAN EXAMPLE", "morning_line": "5-2" }
        ],
        "dupleta_y_polla": [
          { "numero_ejemplar": "1", "nombre": "AMERICAN EXAMPLE" }
        ]
      }
    }
  ]
}
`;

/** Nombre canónico consumido por la plataforma (Gaceta IA / importador). */
export const PROMPT_AMERICANAS = PROMPT_EXTRACTOR_AMERICANAS_V2;
