# Precio automático por pie adicional

Copia TODOS los archivos de `src` de este ZIP a `mi-cotizador/src`, acepta reemplazar y recarga con Ctrl+F5. Conserva main.jsx, index.css, assets y los demás archivos de tu proyecto.

El cálculo compara exclusivamente el mismo tipo de remolque, ancho, capacidad/configuración de ejes y equipo incluido (piso, redila, rampas, jalón, gato, suspensión, llantas, frenos, techo, puertas y demás campos de la base). Nunca usa otra capacidad o ancho para completar una tarifa.

- Promedio automático ponderado: diferencia de precios de los extremos comparables dividida entre diferencia de largos.
- Para un largo fuera del catálogo: modelo inferior más cercano + pies adicionales × tarifa del grupo.
- Si la medida ya existe, prevalece su precio exacto; no se sustituye por un promedio ni por una tarifa manual.
- Si faltan dos largos distintos comparables, o hay variantes ambiguas, no inventa una tarifa. Queda para captura manual en el panel.
- Los accesorios se cobran aparte; las estimaciones siguen identificadas como tales, incluso si la tarifa manual fue validada.
- En Remolques especiales también se buscan comparables. La tarifa por pie capturada específicamente para ese modelo funciona como alternativa manual; no modifica los precios exactos de catálogo.

Ejemplo probado: cama baja abierta, madera, ancho60 pulgadas, 3t. Promedio $1,197.53 por pie. Para14 pies: base12 de $52,559.42 +2 pies = $54,954.48 antes de extras. En60 pulgadas y6t el promedio es $2,205.96 y el de14 pies resulta $81,778.95 antes de extras: ambos cálculos son independientes.

Panel de Control → Modelos de Línea → Ajustes de precio por largo: muestra los largos comparables, permite una tarifa manual y ofrece **Usar promedio automático**. Las tarifas anteriores se conservan únicamente cuando su grupo sigue siendo inequívoco; si el equipo lo divide en varios grupos, se requiere revisión para no mezclarlos.

Pruebas: precios exactos, modelo inferior más cercano, capacidades3t/6t separadas, anchos distintos, equipo diferente, falta de comparables, tarifas manuales, especiales y funciones anteriores.

---
Historial de versiones; las instrucciones de arriba corresponden a esta entrega.

# Remolques especiales y extras de las fotos

Copia TODOS los archivos de `src` de este ZIP dentro de `mi-cotizador/src`, aceptando reemplazar. Conserva tus otros archivos como index.css, main.jsx y assets. Recarga el navegador con Ctrl+F5.

## Uso

1. En el cotizador pulsa **Remolques especiales**. Selecciona el tipo, ancho, largo, capacidad y variante disponible en el catálogo.
2. Se muestra el equipo incluido y el precio base. Las 25 variantes ya se pueden cotizar, guardar, imprimir y enviar mediante las funciones existentes de WhatsApp/PDF.
3. Añade cantidades en **Extras y cambios**. Cada tipo solo presenta los adicionales que tiene asociados en la lista. Cero conserva el equipo incluido; los extras se suman sin volver a cobrar el modelo.
4. Para medidas fuera del catálogo, el campo **Pies adicionales de largo** requiere la tarifa de ese modelo. Captúrala en Panel de Control → Modelos de Línea → Precio por pie adicional. Si falta, la cotización indica exactamente ese pendiente.

Los selectores de medidas y capacidad eligen combinaciones existentes; pueden ajustar otra selección para cargar una combinación válida. Las características sin una regla confirmada se conservan como parte de la variante base: no se inventan opciones ni costos de fabricación.

## Precios en el Panel de Control

Los extras se conectan a los apartados existentes de gatos, llantas, rampas y accesorios. Sus pestañas incluyen cada familia especial. Se completan precios vacíos con los ya transcritos de las fotos, sin duplicar elementos ni sustituir tarifas que hayas capturado.

Ejemplos de la hoja de 2020, con aumento único de 35%:
- Gato7k: $700 → $945.
- Puerta rampa: $6,000 → $8,100.
- Puerta lateral: $1,500 → $2,025.
- Llanta/rin700-15: $2,150 → $2,902.50.
- Llanta/rin750-16: $3,000 → $4,050.
- Control de freno: $1,800 → $2,430.
- Porta: $800 → $1,080.
- Frenos: $2,500 → $3,375.

Todos son MXN con IVA incluido. Las listas de 2024 no reciben ese aumento. Se conservan las transcripciones anteriores de los bloques de foto incompletos; sigue pendiente revalidarlos con imágenes completas de la parte inferior de volteo y ganadero.

Validación: las 25 bases, sus adicionales publicados, el ajuste de 2020, precios modificados en panel, precios faltantes y selección de los 25 modelos desde la interfaz simulada. USA continúa oculto; se conservaron sus pruebas. Las pruebas no envían mensajes ni escriben a Firebase.

---
Historial de versiones; para instalar esta entrega sigue las instrucciones superiores.

# México activo · revisión del 10 de septiembre de 2026

## Instalación de esta versión

Copia **todos los archivos de la carpeta src del ZIP** dentro de `mi-cotizador/src`, aceptando reemplazar los existentes. No borres la carpeta src: conserva assets, main.jsx, index.css y cualquier otro archivo del proyecto. Esta vez no basta con reemplazar App.jsx, porque se agregaron módulos separados. Recarga con Ctrl+F5 y vuelve a seleccionar el modelo.

## Alcance y revisión

- USA desactivado mediante `USA_HABILITADO = false` en mercados.js: no aparece en selección, catálogo, filtros, tarifas ni historial. Los registros guardados de USA se conservan. Las funciones de cargar/duplicar también rechazan ese mercado mientras esté desactivado.
- `reglas-mexico.js` y `reglas-usa.js` son independientes. `reglas-amacsa.js` selecciona las reglas del mercado permitido. `catalogo-mexico.json` y `accesorios-mexico.json` separan las referencias de México de los archivos USA.
- Se revisaron 211 variantes: 208 cotejadas con las imágenes legibles; 3 de forrajero/piedras no pudieron revalidarse porque la parte inferior de la imagen está incompleta. Se conservan sus datos anteriores y se señalan en el informe.
- Las 186 variantes configurables pasan pruebas de precio base exacto y carga sin alterar medidas/capacidad/equipo. Se habilita el ancho de catálogo de 69 pulgadas y el volteo de 60 pulgadas × 16 pies. Los anchos siguen siendo opciones fijas, no libre captura.
- Anchos México restringidos por familia a las medidas respaldadas por las listas/fotos: cama baja 50/60/72/76/82 pulgadas; cama alta 96; volteo 60/69/76/82; ganadero redondo 60; ganadero con ganso 76. Para una medida fuera de esas fichas se debe dar de alta un modelo y su precio en el panel; no se mezcla automáticamente con otro ancho.
- Las medidas se muestran ordenadas de menor a mayor. En ganadero ganso solo se ofrece la cadena 3/8 × 35"; los ejes muelle parten sin freno, mientras Torflex y capacidades de 5,200/6,000 lb exigen freno en cada eje. El control de freno solo se habilita cuando existe al menos un eje frenado.
- Se añadieron tarifas confirmadas: techo $800 por pie lineal, puerta lateral de cama baja $1,500, gato hidráulico con kit $14,950 (uno) o $23,950 (dos), ejes Torflex 7,000/8,000/10,000 lb, eje 10,000 lb de 46" doble rodado, lona, chapas de caja, luces, pintura en polvo por kg y llantas indicadas. En ganadero ganso, Torflex ajusta automáticamente el ancho estructural de 76 a 79 pulgadas.
- Las otras 25 fichas permanecen disponibles en catálogo, con sus precios y especificaciones; aún no tienen configurador personalizado. Al intentar cargarlas se informa esa limitación en lugar de convertirlas a otra familia.
- Se corrigen RG5 redila fija de 6 toneladas a $111,806.24 y CV15H con tractor de 3 toneladas a $138,535.72.
- Al instalar se restablecen una vez los precios de las referencias originales a los catálogos. Si diferían, se conserva el valor anterior en `precioAnteriorAuditoria`. No se reemplazan modelos propios, tarifas de accesorios capturadas ni datos de USA.
- Se conserva el aumento único de 35% para la lista de 2020, las aclaraciones de equipo incluido y los cargos adicionales del panel.

Abre **Revision-precios-Mexico.html** para ver cada variante, el precio original, el ajuste, la base vigente, las especificaciones y el estado de verificación. Puede imprimirse desde su botón. También enumera los accesorios cuyos bloques de foto faltan por revalidar.

Se verificó la compilación, los cálculos de las 186 variantes, las migraciones, la interfaz simulada en modo México y las pruebas USA activando la bandera solamente dentro de su prueba aislada. Las pruebas no conectan a Firebase ni envían WhatsApp. Se conserva la corrección anterior de impresión.

---

Historial de instrucciones de versiones anteriores (para esta versión sigue la instalación de arriba):

## Corrección de impresión

Para esta actualización reemplaza `src/App.jsx` dentro de `mi-cotizador/src`, recarga el navegador con Ctrl+F5 y abre nuevamente la vista de impresión.

La cotización se imprime desde arriba, sin reservar espacio para los formularios ni conservar el desplazamiento de la vista previa. Se eliminan el alto máximo de pantalla y el recorte del contenedor; las cotizaciones extensas pueden continuar en otra hoja. El membrete vuelve a ser el primer contenido impreso. El bloque de consulta de referencias queda solamente en pantalla; el desglose comercial permanece en el ticket.

Los precios base provienen de las fotos de los catálogos, no de capturas del cotizador. Este ajuste no cambia importes ni reglas. La actualización anterior cotejó el RG6 desmontable 60 pulgadas × 16 pies, 3 toneladas, con el catálogo: $98,269.38 antes del porta adicional.

Se verificaron compilación y pruebas de cálculo/interfaz simulada. La vista real del diálogo de impresión debe comprobarse en tu navegador, pues no está disponible en este entorno.

## Corrección México: RG6 60 pulgadas × 16 pies, 3 toneladas

Reemplaza los archivos `src/App.jsx` y `src/reglas-amacsa.js` en `mi-cotizador/src` por los del ZIP. Los demás archivos src se incluyen para conservar el paquete completo. Recarga el navegador y vuelve a seleccionar Ganadero Redondo, 16 pies, 60 pulgadas, 3 toneladas y redila desmontable; esto carga nuevamente el equipo de fábrica.

- Precio base cotejado con la foto de febrero de 2024: $98,269.38 MXN, IVA incluido. No lleva el aumento de 2020.
- Gato de 2,000 lb incluido para 3 toneladas; el de 6 toneladas conserva 7,000 lb incluido.
- Puerta central corrediza y trasera corrediza incluidas. El de 10 pies no incluye central.
- El porta se suma con el precio vigente de Panel de Control. Con la tarifa inicial de $1,200, el total es $99,469.38. Si capturaste otra tarifa, se conserva y cambia ese total.
- La migración corrige el equipo base antiguo una sola vez; conserva los precios de catálogo y de accesorios que hayas editado. No borres tus datos ni reinicies el catálogo.
- El ticket muestra precio base y adicionales separados; identifica el IVA como incluido para evitar interpretarlo como un segundo cargo.

Verificado mediante compilación, pruebas de cálculo de las 20 variantes de frente redondo de la foto, migración de datos anteriores y selección del RG6 desde la interfaz simulada. No se enviaron mensajes ni se conectaron las pruebas a Firebase.

# Cotizador AMACSA · Modelos base USA

## Instalación

1. Respalda tu carpeta mi-cotizador/src.
2. Descomprime el ZIP y copia TODOS los archivos de su carpeta src a mi-cotizador/src. Son siete archivos: App.jsx, PanelReglas.jsx, reglas-amacsa.js, TipoCambio.jsx, modelos-usa-excel.json, catalogo-usa.js y catalogo-usa.json.
3. Conserva tus archivos main.jsx, index.css y assets. No crees otra carpeta src dentro de src.
4. Ejecuta npm run dev desde mi-cotizador y actualiza el navegador. Necesitas conexión a tu Firebase para sincronizar el catálogo.

El catálogo incorpora los modelos una sola vez al cargar. Conserva los modelos y precios existentes; las ediciones y eliminaciones posteriores de los modelos USA no se deshacen al recargar. Los programas de prueba y este LEEME pueden ir en mi-cotizador, junto a package.json.

## Modelos incorporados

- Dean: 44 modelos, cliente especial USA.
- Wall: 23 modelos, cliente normal USA.
- DH: 6 modelos, cliente normal USA.

En Catálogo y en Modelos de Línea hay filtros por cliente, además de la separación por familia. Cada tarjeta identifica al cliente y muestra el precio BASE EN MXN del Excel. Pulsa Ir a Cotizar para cargar las características del modelo. La cotización convierte ese importe a USD con el tipo de cambio capturado.

Los precios proceden de TOTAL DEL REMOLQUE de COSTOS DEAN 2026.xlsx, sin sumar margen adicional ni volver a agregar los componentes incluidos. Cada modelo conserva la descripción y la celda de origen. El equipo se consulta en Ver equipo incluido del Excel. Se corrigió el bloque Dean de 84 pulgadas por 34 pies, cuyo encabezado anterior se había confundido con una fila de perfil metálico.

Las variantes de eje se preservan a partir de la cantidad y descripción del kit, sin sustituirlas por el paquete general Dean. Las anchuras del modelo permanecen fijas. Los modelos de caja seca también se conservan como su propia familia.

## Características y cambios

Los campos se cargan con los datos identificables en la ficha: medidas, capacidad comercial y descripción de ejes, suspensión, llantas, jalón, gatos, cadena, piso, techo y acabados. Una característica no descrita se presenta como Según ficha Excel o No especificado. No se inventó un precio de cambio para esos componentes. Los títulos y el kit originales permanecen visibles cuando contienen diferencias que requieren revisión de diseño.

La configuración base usa exactamente el total del Excel, sin cargos adicionales por su equipo incluido. Cambiar redila, techo, jalón, gato, suspensión, llantas, pintura, luces o puerta trasera consulta el cargo del panel existente y lo suma una vez. Los cambios sin tarifa válida quedan pendientes. Una tarifa cero explícita es válida; un campo vacío no equivale a cero. Las cantidades adicionales de llantas y gatos usan su precioExtra. Las reducciones que necesitarían una bonificación no generan un descuento inventado.

Cambios de dimensiones u otras especificaciones sin regla de ajuste implementada para la variante USA muestran qué tarifa falta; no se aplica automáticamente el precio base a una configuración distinta. La estimación de largo existente para México se conserva. Revisa el desglose antes de emitir una variante personalizada.

## Tipo de cambio y documentos

La captura del DOF sigue siendo manual verificada. Abre Consultar tipo de cambio en el DOF y usa la fecha de PUBLICACIÓN en DOF del último valor disponible estrictamente anterior a la fecha de cotización. No confundas esa fecha con la de determinación FIX. La aplicación valida fecha y valor; la comprobación de que sea el último publicado la hace el usuario.

Precio USD = importe MXN / tipo de cambio MXN por USD. No se usa 17.40 como factor fijo de venta ni se recalculan los costos internos del Excel. Los importes del panel usados por el cálculo USA deben estar en MXN. Anticipos y ajustes de redondeo de una cotización USA se capturan en USD.

La cotización guarda el modelo seleccionado, su configuración base, el tipo de cambio y sus fechas. Cargar recupera la referencia; duplicar requiere una referencia nueva. El PDF y WhatsApp conservan la moneda USD y el origen del cambio. Un PDF histórico conserva el importe emitido; volver a calcular una configuración utiliza los precios actuales del panel.

Fuente de consulta: https://dof.gob.mx/indicadores_detalle.php?cod_tipo_indicador=158

## Verificación

- Compilación JSX correcta.
- Carga simulada de los 73 modelos: dimensiones, ejes, configuración y precio base exactos; cero cargos por equipo incluido; conversión a USD.
- Migración repetida sin duplicados, conservación de precios editados, perfiles de cliente y cargos adicionales comprobados.
- 23 pruebas de las reglas México y 18 comprobaciones de cambio y referencia Excel.

Pruebas disponibles: node verificar.cjs, node verificar-cambio.cjs, node verificar-interfaz.cjs y node verificar-modelos-usa.cjs. Las dos últimas usan esbuild (incluido habitualmente con Vite). No se enviaron mensajes ni se realizaron escrituras en tu Firebase real durante las pruebas. Falta comprobar la presentación y sincronización en tu instalación.

El botón del tipo de cambio abre directamente el DOF, indicador dólar 158. El rango muestra 31 días y termina el día anterior a la cotización para poder localizar la última publicación si hubo días inhábiles. La captura del valor sigue siendo manual.

Regla confirmada: todos los ejes Torflex llevan freno. La cantidad se iguala automáticamente al número de ejes y los botones de ajuste quedan desactivados. Se valida antes de cotizar y se corrige también el campo de frenos de los modelos del catálogo que tienen cantidad de ejes registrada.

## Corrección de precios pendientes

Se reconectan los adicionales publicados en las listas México con el campo que consulta el cálculo: gatos, puerta rampa y jalón de ganso. Se recuperan importes publicados en campos vacíos una sola vez, conservando los precios numéricos ya capturados. No se copia el precio de una llanta de refacción como cargo de cambio de todo el rodado.

En modelos base USA se consultan ahora las tarifas existentes del panel para luces y otros accesorios, cantidades adicionales, piso por superficie y cajas de herramientas. Se cobran los cambios una vez; mover puertas existentes no tiene cargo por sí solo (la validación de separación se conserva). Campos opcionales vacíos y desactivados no se interpretan como cambios distintos.

Los componentes específicos del Excel que solo tienen costo de material no se convierten automáticamente en cargos de venta. Los cambios de largo USA, las bonificaciones por retiro y opciones sin tarifa siguen requiriendo su regla o precio. Los precios exactos de los modelos base se conservan.

Piso hule USA: el hule del Excel se vincula con las opciones normales hule antiderrapante y hule liso. Se carga antiderrapante por defecto; elegir liso conserva el precio base del modelo. La opción duplicada Según ficha Excel se retira de los selectores y las configuraciones antiguas se convierten al cargar. Los valores que se hubieran capturado en esa opción se conservan archivados, sin sobrescribir los precios de los pisos normales.

## Corrección de frente redondo

En los ganaderos de frente redondo la cadena es de 1/4, incluso con capacidad de 6 toneladas. En modelos de las listas México de 6 toneladas, el gato manual de 7,000 lb está incluido y no genera un cambio cobrado. En 10 pies no hay central incluida; en 12, 14 y 16 pies hay una central corrediza, además de la trasera corrediza. El catálogo se actualiza una sola vez; carga de nuevo el modelo para obtener estos valores en una cotización nueva.

El porta extra de frente redondo México se suma al importe de las fotos. Se usa precio_ganadero_redondo de Porta Extra en el panel; si estaba vacío se recupera una sola vez su precio general existente (1,200 MXN en la base entregada, o el que ya hayas capturado). Las listas imprimibles ya suman un porta y lo indican para evitar duplicarlo. El precio de referencia original de las fotos permanece conservado en los modelos.
