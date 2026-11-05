## Entregables

1. **Repositorio en GitHub:** [URL de tu repositorio]
2. **URL Pública en Netlify:** [URL de tu sitio en Netlify ej. https://mi-proyecto.netlify.app/api/time]
3. **Colección de Postman:** Exportada en la raíz del proyecto como `express_netlify_api.postman_collection.json`.

## 📸 Evidencias Visuales

*(Reemplaza estos textos con tus capturas de pantalla)*
* `[Imagen: Captura de pantalla de la petición GET /api/time en Postman con respuesta 200 OK]`
* `[Imagen: Captura de pantalla de la petición POST /api/send-email en Postman con respuesta 200 OK]`
* `[Imagen: Captura de pantalla de la bandeja de entrada del correo recibiendo el email]`
* `[Imagen: Captura de pantalla del panel de Netlify mostrando las variables de entorno]`

---

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