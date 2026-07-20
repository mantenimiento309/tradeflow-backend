# Respaldo legal — Uso de datos públicos de la FDA en TradeFlow SV

**Fecha:** Julio 2026
**Alcance:** Consumo programático de datos de Import Refusals, Import Entries, Compliance Actions e Inspections del FDA Data Dashboard, y su almacenamiento y consulta en TradeFlow SV.

---

## 1. Los datos son de dominio público

La política oficial del sitio web de la FDA ("Linking to or Copying Information on the FDA Website", fda.gov/about-fda/about-website/website-policies) establece que, salvo indicación contraria, el contenido del sitio web de la FDA — texto y gráficos — no está protegido por copyright, es de dominio público y puede ser republicado, reimpreso y usado libremente por cualquier persona sin necesidad de permiso de la FDA. El crédito como fuente se aprecia pero no es requerido.

Adicionalmente, los datos de openFDA se publican bajo dedicatoria **Creative Commons CC0 1.0 Universal** (open.fda.gov/license), mediante la cual la FDA renuncia a todos sus derechos sobre los datos a nivel mundial, permitiendo expresamente copiar, modificar, distribuir y usar los datos **incluso con fines comerciales**, sin pedir permiso.

## 2. El acceso es autorizado bajo la ley federal de EE.UU. (CFAA)

La ley aplicable a accesos informáticos en EE.UU. es el Computer Fraud and Abuse Act (CFAA, 18 U.S.C. § 1030). La jurisprudencia vigente respalda este uso:

- **Van Buren v. United States (Corte Suprema, 2021):** el CFAA solo aplica cuando se accede a áreas de un sistema a las que no se tiene ningún derecho de acceso. Violar políticas de uso o términos de servicio no constituye delito bajo el CFAA.
- **hiQ Labs v. LinkedIn (Noveno Circuito, 2022):** cuando una red informática permite acceso público a sus datos, acceder a esos datos públicos no constituye "acceso sin autorización". Un sitio público "no tiene portones que subir o bajar".
- **Política del Departamento de Justicia (2022):** el DOJ no presenta cargos basados únicamente en violaciones de términos de servicio de servicios web disponibles al público general.

Los endpoints utilizados (`api-datadashboard.fda.gov/v1/*` con credenciales oficiales otorgadas por la FDA vía OII Unified Logon, y `api-datadashboard.fda.gov/search/IED/select` sin requisito de autenticación) no imponen ninguna barrera de acceso que se esté eludiendo.

## 3. La FDA promueve activamente este uso

- La FDA declara que el Data Dashboard fue creado "para aumentar la transparencia y la rendición de cuentas" y que ofrece "acceso programático a los datos mediante una API".
- El propio dashboard incluye botones de **Download Dataset** (hasta 10,000 filas filtradas) y descarga de archivos de Shipment Details, confirmando que la descarga masiva de estos datos es un uso previsto.
- Las credenciales DDAPI utilizadas fueron solicitadas y otorgadas oficialmente por la FDA mediante el proceso OII Unified Logon.

## 4. No hay datos personales ni información confidencial

Los datasets contienen exclusivamente información comercial de empresas (razón social, dirección comercial, números FEI, productos, fechas de shipment) que la FDA ya publica deliberadamente. openFDA declara explícitamente que no contiene información personal identificable (PII) ni información sensible. No aplican regulaciones de protección de datos personales (GDPR, CCPA o equivalentes) porque no se procesan datos de personas naturales.

## 5. Buenas prácticas adoptadas por TradeFlow SV

Aunque no son requisitos legales, TradeFlow adopta las siguientes medidas de uso responsable:

1. **User-Agent identificable** (`TradeFlowSV/1.0` con correo de contacto) en todas las llamadas.
2. **Rate limiting propio:** delays de 250–400 ms entre peticiones y sincronización según el calendario de actualización oficial de la FDA (entries: jueves por la noche; refusals y compliance: lunes), evitando consultas innecesarias.
3. **Caché local:** los datos se almacenan localmente y las consultas de usuarios se sirven desde la base propia, minimizando la carga sobre servidores federales.
4. **Atribución de fuente** en la interfaz: "Datos provistos por la U.S. Food and Drug Administration (datadashboard.fda.gov)".
5. **Sin alteración del contenido:** los datos se presentan tal como la FDA los publica, con fecha de última sincronización visible.

## Conclusión

El consumo, almacenamiento local y redistribución de estos datasets en TradeFlow SV es lícito: son datos de dominio público del gobierno federal de EE.UU., publicados con el propósito expreso de transparencia, accesibles sin barreras de autenticación (o con credenciales otorgadas oficialmente), sin términos de servicio que prohíban el uso programático, y sin datos personales involucrados.

---

*Este documento es un resumen informativo de políticas públicas y jurisprudencia, no constituye asesoría legal formal.*
