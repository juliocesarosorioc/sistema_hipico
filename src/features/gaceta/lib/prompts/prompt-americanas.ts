/**
 * ============================================================================
 * PROMPT PROFUNDO EXCLUSIVO PARA "AMERICANAS (EE. UU.)"
 * ============================================================================
 * Motor de Extracción Documental y Estructuración Hípica de Precisión Total
 * para retrospectos de Estados Unidos.
 *
 * Limpia TODAS las variantes de la marca de agua recurrente de Retro Hípico y
 * obliga al modelo a leer cada fila como una unidad espacial (coordenada Y con
 * tolerancia de fila) antes de ordenar las columnas por coordenada X.
 */

/** Marcas de agua / ruido que el PDF de Retro Hípico incrusta en el texto. */
export const MARCA_AGUA_RETRO_HIPICO_REGEXES: RegExp[] = [
  /Este\s+retrospecto\s+es\s+generado\s+por/gi,
  /Este\s+retros(?:pecto)?\b/gi,
  /Este\s+TOS\b/gi,
  /Este\s+ros\b/gi,
  /RETRO\s*H[ÍI]PICO(?:\s*0?414\s*9132896)?/gi,
  /0?414\s*9132896/g,
  /(?:rospect|trospect)[a-z]*/gi,
];

/** Compatibilidad con el export histórico. */
export const MARCA_AGUA_RETRO_HIPICO_REGEX = /RETRO\s*H[ÍI]PICO(?:\s*0?414\s*9132896)?/gi;

/**
 * Limpia todas las marcas de agua y fragmentos huérfanos ANTES de parsear.
 * Se aplica tanto al texto que consume el parser determinístico como al texto
 * que se envía al modelo multimodal como apoyo de las imágenes.
 */
export function limpiarMarcaAguaRetrospecto(texto: string): string {
  if (!texto) return "";
  let limpio = texto;
  for (const re of MARCA_AGUA_RETRO_HIPICO_REGEXES) {
    limpio = limpio.replace(re, "");
  }
  return limpio
    .split(/\r?\n/)
    .map((linea) => linea.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Instrucción estricta de lectura visual para modelos multimodales.
 * Se agrega al cuerpo de Gemini junto con las imágenes (y el texto, si existe).
 */
export const INSTRUCCION_LECTURA_VISUAL_FILAS = `
LECTURA VISUAL OBLIGATORIA (PÁGINAS COMO IMAGEN):
- Analiza la imagen de cada página; NO transcribas únicamente una capa de texto plano.
- Antes de ordenar por coordenada X, agrupa todos los elementos por coordenada Y con tolerancia de fila. Nunca leas una columna completa de arriba abajo: lee CADA FILA completa de izquierda a derecha.
- La columna izquierda "N./ML" NO debe despegarse del resto de su fila. Empareja el número de programa, el morning line y la primera palabra del nombre con el PP, jinete, peso y entrenador de ESA MISMA fila.
- Si la primera palabra del nombre quedó reubicada al pie de página junto a "Stud:", reconstruye el nombre completo (por ejemplo "Obi" + "Kenobi" = "OBI KENOBI"). Nunca mezcles "Stud:", ni códigos de sexo/edad/pedigrí (YC3a-, YZ4a-, CC5a-, C2a-, Y3a-, CC3a-, p.) dentro del nombre.
- La línea de resumen en inglés (ENTRIES 1ST WOX, 2ND RPX, 3RD PRX, 1ST PEN, MVR, LSX, FGX, EVD, DED, CTX) es la FUENTE DE VERDAD para el hipódromo y el número de carrera. Mapea WOX=Woodbine, RPX=Remington Park, PRX=Parx Racing, PEN=Penn National, MVR=Mahoning Valley, LSX=Lone Star Park, FGX=Fair Grounds, EVD=Evangeline Downs, DED=Delta Downs, CTX=Charles Town. Corrige OCR como "HOLLYWOOD AT CHARLES TOO" a "CHARLES TOWN". Número de carrera: 1ST..12TH o 1a..12a.
- Distancias: si es THOROUGHBRED y la línea inglesa dice 4.5F=900m, 5F=1000m, 5.5F=1100m, 6F=1200m, 6.5F=1300m, 7F=1400m, 7.5F=1500m, 8F/1 MILE=1600m, 8F70Y/1 MILE 70 YARDS=1664m, 8.5F/1 1/16 MILES=1700m, 9F=1800m, usa esa conversión aunque el encabezado español esté recortado. Si es QUARTER HORSE o MIXED, ignora "XXX.00 FURLONGS" y toma los metros del encabezado español (100 a 500).
- Superficie: prioriza Tapeta/Sintética si aparece en español (aunque Equibase diga DIRT), luego Grama/TURF, y Arena en caso contrario.
- Por cada ejemplar extrae: numero, pp, morning_line, nombre completo, jinete, peso_kg (coma decimal -> punto), entrenador, es_ae/es_mto, campana ("Act: (C-1-2-3) $Ganancias") y dias_sin_correr ("XXd S/C"; "0d S/C" = debutante, NO lo marques como fallido por no tener retrospectos).
- Si dos páginas consecutivas tienen el mismo hipódromo y número de carrera, concatena los ejemplares nuevos en la MISMA carrera sin duplicar por numero/pp y sin sobrescribir los anteriores.
- No inventes datos. Si un nombre quedó vacío o un número se repite dentro de una carrera, repórtalo en la respuesta antes de devolver el JSON.
`;

export const PROMPT_EXTRACTOR_AMERICANAS_V2 = `
Eres un Motor de Extracción Documental y Estructuración Hípica de Precisión Total para retrospectos de Estados Unidos (BEL, CD, CT, DED, DMR, EVD, FL, GP, IND, LRL, LS, MNR, MVR, PEN, PRX, RP, SAR, WOX, RPX, PRX, LSX, FGX).
Tu misión es extraer el 100% de la información de la gaceta sin omitir ningún ejemplar, actuación pasada ni trabajo matutino, y estructurarla en un único objeto JSON válido.

Lee las páginas como IMÁGENES, agrupando primero por coordenada Y (tolerancia de fila) y ordenando después por X. La marca de agua de Retro Hípico ya fue eliminada del texto de apoyo.

${INSTRUCCION_LECTURA_VISUAL_FILAS}

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
   - Usa la línea Equibase en inglés como fuente primaria: WOX=Woodbine, RPX=Remington Park, PRX=Parx Racing, PEN=Penn National, MVR=Mahoning Valley, LSX=Lone Star Park, FGX=Fair Grounds, EVD=Evangeline Downs, DED=Delta Downs, CTX=Charles Town; número 1ST..12TH o 1a..12a.
   - Extrae: "hipodromo", "codigo_hipodromo", "fecha" (YYYY-MM-DD), "numero_carrera", "hora" (formato 24h), "distancia_m" (metros enteros), "superficie" ("Arena", "Grama", "Tapeta"), "raza" ("THOROUGHBRED" o "QUARTER HORSE"), "bolsa_usd" (entero de Purse), "condicion_lote" (ej. "Clm 7500n2l") y "linea_programa_completa".

4. DATOS DEL EJEMPLAR EN LA CARRERA DE HOY:
   - "numero_programa": Número o llave en la columna izquierda ("1", "1A", "2"...).
   - "puesto_partida": Número entero en la columna "PP".
   - "morning_line": Cotización con guion ("8-1", "5-2", "9-5").
   - Toma "jinete", "peso_kg" (convirtiendo coma a punto decimal: "56,2" -> 56.2) y "entrenador" exclusivamente de la columna "Jin/Kgs/Ent" de HOY (ubicada antes de las fechas DD/MM de carreras previas).
   - Extrae "stud", "sexo", "pelaje", "edad_anios", "anio_nacimiento", "padre", "madre", "abuelo_materno", "dias_sin_correr" (de "XXd S/C"); "0d S/C" significa debutante sin fallar por ausencia de retrospectos, NO lo marques como error.
   - Extrae "campana_resumen" de "Act: (C-1-2-3) $Ganancias" y "ganancias_usd".
   - Marca "es_elegible": true y "condicionElegibilidad" = "AE" o "MTO" cuando corresponda, conservando el número de programa.
   - Si dos páginas consecutivas tienen el mismo hipódromo y el mismo número de carrera, FUSIONA todos los ejemplares en la misma carrera sin sobrescribir los anteriores ni duplicar por numero/pp.

5. VALIDACIÓN FINAL ANTES DE EMITIR EL JSON:
   - Ningún "nombre" puede quedar vacío.
   - No puede haber dos ejemplares con el mismo "numero" dentro de una carrera.
   - Si detectas cualquiera de esos dos casos, inclúyelo en un campo "advertencia" del JSON y NO lo corrijas inventando datos.

6. CARRERAS PREVIAS ("carreras_previas") Y TRABAJOS ("trabajos"):
   - Extrae todas las filas de actuaciones pasadas separando: "fecha" (YYYY-MM-DD), "hipodromo", "numero_carrera", "distancia_m", "pp", "pos_400m" (columna 1), "pos_800m" (columna 2), "pos_llegada" (columna Ll), "peso_jinete_kg", "jinete", "dividendo", "ganador", "cuerpos", "lote", "rating" (columna Rat), "tiempo_ganador" (TG) y "tiempo_ejemplar" (TE).
   - Extrae todos los briseos al pie del ejemplar ("hXd, DIST en TIEMPO-SUP-EST (RANK)-HIP").

7. ESTRUCTURA PARA MODALES DE LA PLATAFORMA ("vistas_modales"):
   - Dentro de cada carrera, genera también el objeto "vistas_modales":
     - "tablas_fijas_y_remates": array con { "numero_ejemplar", "nombre", "morning_line" }.
     - "dupleta_y_polla": array con { "numero_ejemplar", "nombre" }.

ESTRUCTURA DEL RESULTADO JSON OBLIGATORIA (devuelve SOLO el JSON, sin markdown):
{
  "carreras": [
    {
      "hipodromo": "WOODBINE",
      "codigo_hipodromo": "WOX",
      "fecha": "YYYY-MM-DD",
      "hora": "14:15",
      "numero_carrera": 1,
      "distancia_m": 1200,
      "superficie": "Tapeta",
      "raza": "THOROUGHBRED",
      "bolsa_usd": 32000,
      "condicion_lote": "Clm 16000b",
      "linea_programa_completa": "Purse 32.000 CLAIMING 16000-12500 ...",
      "advertencia": null,
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
          "es_debutante": false,
          "ganancias_usd": 45200,
          "rating_ultimo": 84,
          "rating_maximo": 92,
          "jinete": "I. Ortiz Jr.",
          "entrenador": "T. Pletcher",
          "peso_kg": 54.4,
          "es_elegible": false,
          "condicionElegibilidad": null,
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
