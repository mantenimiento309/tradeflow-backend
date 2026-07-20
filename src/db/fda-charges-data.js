/*
  Códigos de refusal de la FDA más comunes, con su sección legal (FD&C Act),
  categoría (ADULTERATION / MISBRANDING) y descripción en español e inglés.

  Esta es una referencia local curada — más confiable que depender del CSV
  remoto de la FDA que cambia de formato. Cubre los códigos que aparecen en
  la mayoría de rechazos a productos de El Salvador (alimentos, etc.).
*/

const FDA_CHARGES = [
  { code: 'FILTHY', section: '402(a)(3)', category: 'ADULTERATION', es: 'El producto parece estar sucio, putrefacto o descompuesto, o no apto para consumo.', en: 'The article appears to consist in whole or in part of a filthy, putrid, or decomposed substance.' },
  { code: 'SALMONELLA', section: '402(a)(1)', category: 'ADULTERATION', es: 'El producto parece contener Salmonella, una bacteria que causa enfermedad.', en: 'The article appears to contain Salmonella, a poisonous and deleterious substance.' },
  { code: 'INSANITARY', section: '402(a)(4)', category: 'ADULTERATION', es: 'El producto fue preparado, empacado o almacenado en condiciones insalubres.', en: 'The article appears to have been prepared, packed, or held under insanitary conditions.' },
  { code: 'NEEDS FCE', section: '402(a)(4)', category: 'ADULTERATION', es: 'El procesador no registró el establecimiento (Food Canning Establishment) ante la FDA.', en: 'The manufacturer is not registered as a Food Canning Establishment.' },
  { code: 'NO PROCESS', section: '402(a)(4)', category: 'ADULTERATION', es: 'No se presentó el proceso de elaboración (Scheduled Process) requerido a la FDA.', en: 'The manufacturer has not filed required process information with FDA.' },
  { code: 'PESTICIDE', section: '402(a)(2)(B)', category: 'ADULTERATION', es: 'El producto parece contener residuos de pesticidas no autorizados.', en: 'The article appears to contain a pesticide chemical which is unsafe.' },
  { code: 'AFLATOXIN', section: '402(a)(1)', category: 'ADULTERATION', es: 'El producto parece contener aflatoxina, una toxina producida por hongos.', en: 'The article appears to contain aflatoxin, a poisonous substance.' },
  { code: 'POISONOUS', section: '402(a)(1)', category: 'ADULTERATION', es: 'El producto parece contener una sustancia venenosa o nociva para la salud.', en: 'The article appears to contain a poisonous or deleterious substance.' },
  { code: 'UNSAFE COL', section: '402(c)', category: 'ADULTERATION', es: 'El producto contiene un colorante no permitido o no certificado por la FDA.', en: 'The article appears to contain an unsafe color additive.' },
  { code: 'UNSAFE ADD', section: '402(a)(2)(C)', category: 'ADULTERATION', es: 'El producto contiene un aditivo alimentario no autorizado.', en: 'The article appears to contain an unsafe food additive.' },
  { code: 'LOW ACID', section: '402(a)(4)', category: 'ADULTERATION', es: 'Producto de baja acidez enlatado sin cumplir los requisitos de proceso.', en: 'The article appears to be a low-acid canned food not in compliance.' },
  { code: 'HISTAMINE', section: '402(a)(1)', category: 'ADULTERATION', es: 'El producto (usualmente pescado) parece contener niveles altos de histamina.', en: 'The article appears to contain histamine, indicating decomposition.' },
  { code: 'MELAMINE', section: '402(a)(1)', category: 'ADULTERATION', es: 'El producto parece contener melamina, una sustancia no permitida.', en: 'The article appears to contain melamine.' },
  { code: 'VETDRUG', section: '402(a)(2)(C)(ii)', category: 'ADULTERATION', es: 'El producto parece contener residuos de medicamentos veterinarios no aprobados.', en: 'The article appears to contain an unapproved new animal drug residue.' },
  { code: 'HEAVY METAL', section: '402(a)(1)', category: 'ADULTERATION', es: 'El producto parece contener metales pesados (plomo, cadmio) en exceso.', en: 'The article appears to contain heavy metals above tolerance.' },

  { code: 'LABELING', section: '403(a)(1)', category: 'MISBRANDING', es: 'El etiquetado del producto es falso o engañoso.', en: 'The labeling appears to be false or misleading.' },
  { code: 'NO ENGLISH', section: '403(f)', category: 'MISBRANDING', es: 'La información obligatoria de la etiqueta no aparece en inglés.', en: 'Required label information does not appear in English.' },
  { code: 'NUTRIT', section: '403(q)', category: 'MISBRANDING', es: 'Falta la etiqueta de información nutricional (Nutrition Facts) o es incorrecta.', en: 'The product lacks required nutrition labeling.' },
  { code: 'NO INGRED', section: '403(i)(2)', category: 'MISBRANDING', es: 'No se declara la lista de ingredientes, o está incompleta.', en: 'The label fails to declare all ingredients.' },
  { code: 'ALLERGEN', section: '403(w)', category: 'MISBRANDING', es: 'No se declaran alérgenos mayores en la etiqueta (leche, maní, etc.).', en: 'The label fails to declare a major food allergen.' },
  { code: 'NO PLANT', section: '403(e)(1)', category: 'MISBRANDING', es: 'La etiqueta no indica el nombre y lugar del fabricante o empacador.', en: 'The label fails to state the name and place of business.' },
  { code: 'NO IDENT', section: '403(i)(1)', category: 'MISBRANDING', es: 'La etiqueta no indica el nombre común o usual del alimento.', en: 'The label fails to bear the common or usual name of the food.' },
  { code: 'NO QUANT', section: '403(e)(2)', category: 'MISBRANDING', es: 'La etiqueta no declara la cantidad neta de contenido.', en: 'The label fails to declare an accurate net quantity of contents.' },
  { code: 'NO COUNTRY', section: '304(a)', category: 'MISBRANDING', es: 'El producto no indica el país de origen.', en: 'The article fails to declare country of origin.' },
  { code: 'COLOR LABEL', section: '403(k)', category: 'MISBRANDING', es: 'No se declara la presencia de colorantes artificiales en la etiqueta.', en: 'The label fails to declare the presence of artificial coloring.' },
  { code: 'NO PROCNAME', section: '403(e)(1)', category: 'MISBRANDING', es: 'No se identifica al fabricante, empacador o distribuidor.', en: 'The label fails to identify the manufacturer, packer, or distributor.' },
];

module.exports = { FDA_CHARGES };
