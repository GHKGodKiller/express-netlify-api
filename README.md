## Entregables

1. **Repositorio en GitHub:** https://github.com/GHKGodKiller/express-netlify-api
2. **URL Pública en Netlify:** https://netlifyleonardo.netlify.app

## Preguntas Teóricas de Reflexión Arquitectónica

### 1. Cold Start
**¿Qué es el fenómeno de Cold Start en funciones serverless y qué impacto tiene en los tiempos de respuesta de una API creada con Express?**
El "Cold Start" (Arranque en frío) ocurre cuando una función serverless es invocada después de un periodo de inactividad. Como no hay un servidor encendido 24/7, el proveedor de la nube (ej. AWS) debe aprovisionar un contenedor, cargar el entorno de ejecución, inicializar el código (en este caso cargar todo el framework Express) y luego procesar la solicitud. Esto genera una latencia inicial notable (de varios cientos de milisegundos a segundos) en la primera petición, aunque las peticiones subsecuentes (Warm Starts) serán muy rápidas mientras el contenedor siga vivo.

### 2. Estado Efímero (Statelessness)
**Si declaras una variable global `let contador = 0;` en api.js y la incrementas en cada petición HTTP, ¿por qué el resultado es impredecible y no debe usarse para contar visitas en producción?**
Las funciones serverless son de naturaleza efímera y sin estado. El proveedor de la nube puede crear y destruir contenedores dinámicamente según la demanda. Si hay muchas peticiones, Netlify puede levantar múltiples instancias de tu función simultáneamente; cada una tendrá su propio `contador = 0`. Además, cuando la función se suspende y el contenedor muere, la memoria RAM se libera y el contador se reinicia a cero. Por ello, el estado y persistencia de datos debe manejarse externamente (bases de datos como MongoDB, PostgreSQL o Redis).

### 3. Patrón Adapter
**¿Por qué Express no puede procesar directamente el evento de AWS Lambda / Netlify y qué función cumple exactamente serverless-http?**
Express fue diseñado para operar sobre el módulo nativo `http` de Node.js, esperando recibir objetos del tipo `http.IncomingMessage` y `http.ServerResponse` a través de un socket de red continuo. Sin embargo, AWS Lambda y Netlify Functions no envían estos objetos, sino que disparan la ejecución de la función inyectando un objeto JSON plano que representa el evento HTTP. La librería `serverless-http` actúa como un adaptador que toma ese JSON, simula los objetos `req` y `res` estándar de Node/Express, y luego transforma la respuesta de Express de vuelta al formato JSON que Lambda requiere para responder al cliente.

### 4. Principios de 12-Factor App y Seguridad
**¿Por qué subir un archivo .env a un repositorio público en GitHub representa una falla crítica de seguridad y de qué manera la inyección de variables de entorno de Netlify soluciona este riesgo?**
Subir un `.env` expone contraseñas, tokens, conexiones a bases de datos y claves secretas al mundo entero. Bots maliciosos escanean GitHub constantemente buscando estas credenciales expuestas para robar datos, enviar spam (usando tu SMTP) o secuestrar infraestructura. Netlify soluciona esto permitiendo definir estas variables directamente en su panel de administración. De esta forma, el código fuente (GitHub) queda totalmente separado de la configuración del entorno (Netlify), cumpliendo con el principio "Config" de 12-Factor App y garantizando que solo el entorno de ejecución tenga acceso a los secretos en memoria temporal.

### 5. Riesgo de Open Relay y Abuso
**¿Qué consecuencias técnicas y de reputación de dominio enfrenta un servidor que expone un endpoint POST de correo sin autenticación, captcha ni límites de tasa (rate limiting)?**
Exponer un endpoint de envío de correo público permite que cualquier usuario o bot malicioso lo utilice como un "Open Relay" para enviar phishing, malware o spam de forma masiva utilizando tu infraestructura. Las consecuencias incluyen: la inclusión del dominio del remitente y de la IP del servidor SMTP en listas negras (DNSBL/Spamhaus), la suspensión inmediata de tu cuenta por parte del proveedor (ej. Gmail o SendGrid), daños a la reputación corporativa y posibles costos económicos excesivos si el servicio SMTP factura por volumen de envíos.
# Tarea 7: API de Telemetría con Netlify Blobs
 
## Entregables (Tarea 7)
 
1. **Repositorio en GitHub:** https://github.com/GHKGodKiller/express-netlify-api
2. **URL Pública en Netlify:** https://netlifyleonardo.netlify.app
3. **Colección Postman:** `telemetria_netlify_blobs.postman_collection.json`
4. **Evidencia:**
 
### 1. Persistencia vs. Estado Efímero
**¿De qué manera Netlify Blobs resuelve este problema arquitectónico y qué diferencias clave existen entre un almacén Clave-Valor/Objeto y una base de datos relacional (SQL) para métricas de eventos?**
 
Netlify Blobs externaliza el estado: los datos viven en un servicio de almacenamiento administrado por la plataforma, independiente del ciclo de vida del contenedor de la función. Cuando el contenedor se congela o se destruye, los datos permanecen, y cualquier instancia posterior (o concurrente) accede al mismo almacén a través del SDK. Así se respeta el principio de funciones sin estado: la función no guarda nada en memoria, solo lee y escribe en un servicio persistente.
 
Diferencias frente a SQL:
 
- **Modelo de datos:** Blobs guarda objetos (JSON) bajo una clave, sin esquema fijo. SQL impone tablas, columnas y tipos, con restricciones de integridad.
- **Consulta:** en Blobs solo se accede por clave o por prefijo (`list`). No hay `WHERE`, `JOIN` ni `GROUP BY`; las agregaciones se calculan en la aplicación. SQL las resuelve en el motor, con índices.
- **Transacciones:** SQL ofrece ACID entre múltiples filas y tablas. Blobs no tiene transacciones multi-clave.
- **Ajuste para eventos:** las métricas son registros inmutables de solo-inserción. Con una clave única por evento no hay conflictos de escritura (nunca se hace lectura-modificación-escritura sobre un mismo registro) y la operación es simple, barata y sin servidor de base de datos que administrar. A cambio, el análisis complejo y a gran escala es mucho más cómodo en SQL.
### 2. Consistencia Fuerte vs. Consistencia Eventual
**¿Qué significa cada una y qué sucedería en el panel con consistencia eventual bajo alto tráfico?**
 
Con **consistencia fuerte**, una vez confirmada una escritura, cualquier lectura posterior (desde cualquier nodo) devuelve ese dato actualizado. Con **consistencia eventual**, las réplicas convergen con el tiempo, pero durante un intervalo una lectura puede devolver datos desactualizados. Es el clásico compromiso de los sistemas distribuidos: la consistencia eventual favorece latencia y disponibilidad; la fuerte, la corrección de lo leído, normalmente con algo más de latencia.
 
En nuestro panel, con consistencia eventual y alto tráfico concurrente, `store.list()` y `store.get()` podrían no incluir los eventos recién escritos: el `totalEvents` quedaría por debajo del real, los desgloses por fase y fuente fluctuarían entre recargas consecutivas y un evento recién enviado podría no aparecer de inmediato. Los datos no se perderían (acabarían apareciendo), pero el panel mostraría una imagen temporalmente incorrecta, algo indeseable en una demostración en vivo.
 
### 3. Garantía de Envío en Frontend (`keepalive` y `navigator.sendBeacon`)
**¿Por qué `fetch()` tradicional corre el riesgo de abortarse y cómo lo resuelven `keepalive: true` y `sendBeacon()`?**
 
Cuando el usuario navega a otra página, el navegador destruye el contexto del documento actual y cancela las peticiones en curso. Un `fetch()` normal lanzado justo en el clic puede abortarse antes de que el servidor lo reciba, y la métrica se pierde.
 
Con `keepalive: true`, el navegador permite que la petición sobreviva a la descarga de la página y la completa en segundo plano (con un límite de tamaño de cuerpo de aproximadamente 64 KB). `navigator.sendBeacon(url, data)` es una API diseñada para esto: encola un POST asíncrono y de baja prioridad que el navegador garantiza intentar enviar aunque la página se cierre. Sus limitaciones: solo POST, sin respuesta legible y sin cabeceras personalizadas. Por eso el frontend usa `fetch` con `keepalive` como mecanismo principal y `sendBeacon` como respaldo.
 
### 4. Particionamiento y Escalabilidad de Claves
**Si el funnel registrara 100,000 eventos, ¿qué problema enfrentaría `GET /api/metrics` y cómo se mitiga?**
 
`store.list()` devolvería un listado enorme (paginado internamente) y luego se ejecutarían 100,000 lecturas individuales con `store.get()`. Esto implica latencia muy alta, consumo de memoria y red, mayor costo y, sobre todo, riesgo de superar el tiempo máximo de ejecución de la función serverless (los timeouts de Netlify Functions son de segundos), devolviendo errores o respuestas incompletas. Por eso la implementación incluye un tope de seguridad de 5000 eventos y lectura por lotes, pero eso es una mitigación parcial.
 
Mitigaciones en producción:
 
- **Paginación:** devolver los eventos por páginas (`limit`/`cursor`) en lugar de todos a la vez.
- **Prefijos por fecha:** claves como `metric_2026-11-09T21_...` permiten listar solo una ventana de tiempo con `list({ prefix })`.
- **Contadores agregados:** mantener resúmenes precalculados por fase y fuente (idealmente por fragmentos o con una función programada que consolide), para que el panel lea unas pocas claves en vez de miles de eventos. Un único contador compartido sufriría condiciones de carrera por el patrón lectura-modificación-escritura.
- **Base de datos analítica:** para este volumen, un motor SQL o de series temporales es la herramienta adecuada.
- **Caché:** responder con `Cache-Control` unos segundos para no recalcular en cada visita.
### 5. Higiene de Datos y Prevención de Spam
**¿Qué riesgos existen en un `POST /api/metrics` público y qué técnicas se implementarían?**
 
Riesgos: métricas falsas que contaminan el análisis; inundación de peticiones (denegación de servicio o crecimiento descontrolado del almacenamiento y del costo); payloads enormes o malformados; y datos maliciosos (por ejemplo, HTML o scripts en `metadata`) que podrían ejecutarse si el panel los renderiza sin escapar.
 
Técnicas:
 
- **CORS estricto** con lista blanca de orígenes. Aclaración: CORS solo restringe a los navegadores; un script con `curl` lo ignora, por lo que no basta por sí solo.
- **Rate limiting** por IP o sesión (reglas de Netlify, o un contador en Redis/Upstash), con respuesta `429`.
- **Validación de esquema** con Zod o Joi: `step` restringido a un enum de fases válidas, longitudes máximas y tipos estrictos en `metadata`.
- **Límite de tamaño del cuerpo** (ya implementado: 10 KB) y de `metadata` (2000 caracteres).
- **Verificación anti-bot** (CAPTCHA o Cloudflare Turnstile) y tokens de sesión firmados emitidos por el servidor.
- **Deduplicación** por `sessionId` + `step` y detección de anomalías.
- **Escapado de salida** al mostrar datos en cualquier panel.
 