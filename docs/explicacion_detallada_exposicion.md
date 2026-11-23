# Guía de Estudio para la Exposición: Cómo Funciona Todo Paso a Paso

Este documento te explica **lento, desde cero y en orden** cómo funciona cada pieza del proyecto para que puedas entenderlo a fondo y defenderlo con seguridad en la exposición.

---

## 1. La película completa (antes de entrar al código)

Imagina que tienes dos mundos corriendo al mismo tiempo dentro de tu computadora gracias a **Docker Compose**:

1. **El mundo del tráfico (la aplicación):**
   Un usuario (tu navegador o `k6`) hace una petición HTTP a `http://localhost:8080`.
   No habla directo con NestJS: primero llega a **Nginx** (puerto `8080`), que actúa como puerta de entrada única y reparte las peticiones por turnos (*round-robin*) entre tres contenedores idénticos de NestJS: `backend-1`, `backend-2` y `backend-3`.

2. **El mundo de la observabilidad (el monitoreo):**
   Mientras los contenedores atienden tráfico, **Prometheus** (puerto `9090`) sale cada **15 segundos** a "recoger" métricas de todos lados:
   - Pregunta a `backend-1`, `backend-2` y `backend-3` en `/metrics` cuántas peticiones atendieron y cuánto tardaron.
   - Pregunta a **Nginx Prometheus Exporter** (`nginx-exporter:9113`) cuántas conexiones y peticiones lleva Nginx.
   - Pregunta a **cAdvisor** (`cadvisor:8080`) cuánta CPU, memoria y red está consumiendo cada contenedor.

   Por último, **Grafana** (puerto `3000`) se conecta a Prometheus, consulta esos datos y los dibuja en **3 tableros** en tiempo real.

```text
  [Navegador / k6]
         |
         v  (http://localhost:8080)
     [ Nginx ]  <--- puerto interno 8081 (/nginx_status) <--- [ nginx-exporter :9113 ]
      /  |  \                                                           |
     v   v   v                                                          |
  [b-1] [b-2] [b-3]  (puerto interno 3000)                              |
     |   |   |                                                          |
     +---+---+--- (/metrics) ---> [ Prometheus :9090 ] <----------------+
                                           ^                            |
                                           |                            |
                                    [ cAdvisor :8080 ] -----------------+
                                           |
                                           v
                                   [ Grafana :3000 ]
```

---

## 2. La red Docker y los puertos (`docker-compose.yml`)

Todos los servicios (8 contenedores en total) están conectados a una **red privada virtual** llamada `monitoring-net` (`driver: bridge`).

### ¿Por qué es clave esa red?
- Dentro de `monitoring-net`, los contenedores se encuentran **por su nombre de servicio**, no por IP. Por eso Nginx puede escribir `backend-1:3000` y Prometheus puede escribir `nginx-exporter:9113`: el DNS interno de Docker traduce esos nombres a la IP privada de cada contenedor.
- **Seguridad por diseño (principio de mínima exposición):** hacia tu Mac (`localhost`) solo publicamos **3 puertos**:
  - `8080` → **Nginx** (entrada a la API)
  - `9090` → **Prometheus** (interfaz de consultas y estado de targets)
  - `3000` → **Grafana** (dashboards)

Los 3 backends (`backend-1`, `backend-2`, `backend-3`), `nginx-exporter`, `cadvisor` y el puerto `8081` de Nginx **no están expuestos al host**. Nadie desde afuera puede saltarse a Nginx para pegarle directo a `backend-2`.

---

## 3. El Backend en NestJS (`backend/`)

Los tres contenedores (`backend-1`, `backend-2`, `backend-3`) se construyen desde **exactamente el mismo código y el mismo `Dockerfile`**. Lo único que cambia entre ellos es una variable de entorno definida en `docker-compose.yml`:
- `INSTANCE_ID=backend-1`
- `INSTANCE_ID=backend-2`
- `INSTANCE_ID=backend-3`

### 3.1 Qué endpoints tiene y para qué sirve cada uno

1. **`GET /`** (`backend/src/app.controller.ts`)
   Devuelve un JSON con `service: "incident-api"`, `instanceId` (ej. `"backend-1"`), `status: "ok"` y `timestamp`.
   - **Para qué sirve en la expo:** cuando hacés varias peticiones seguidas a `http://localhost:8080/`, ves cambiar `backend-1` → `backend-2` → `backend-3`. Así demostrás visualmente el balanceo de carga.

2. **`GET /health`** (`backend/src/app.controller.ts`)
   Devuelve `{ status: "ok", instanceId, uptime, timestamp }`.
   - **Para qué sirve:** lo usa el `healthcheck` de Docker cada 10 segundos para saber si el contenedor NestJS ya terminó de arrancar y está sano para recibir tráfico.

3. **`GET /incidents`, `POST /incidents`, `GET /incidents/:id`** (`backend/src/incidents/`)
   Es un módulo CRUD pequeño de reportes de incidentes (`id`, `title`, `description`, `type`, `zone`, `createdAt`).
   - `POST /incidents` valida los campos con `ValidationPipe` + `CreateIncidentDto` (`class-validator`). Si falta un campo o mandás propiedades extra no permitidas (`forbidNonWhitelisted: true`), responde `400 Bad Request`.
   - Si todo está bien, genera un UUID con `crypto.randomUUID()` y lo guarda en un arreglo en memoria en `IncidentsService`.
   - **Detalle importante (`MAX_INCIDENTS = 1000`):** en `incidents.service.ts` limitamos el arreglo a 1000 elementos (si se llena, borra el más viejo con `shift()`). Así evitamos que una prueba de carga larga con `k6` llene la memoria RAM del contenedor y lo tumbe.
   - **Qué decir si el profesor pregunta por qué es en memoria:** el objetivo del proyecto es demostrar infraestructura, balanceo y monitoreo, no persistencia de negocio. Además, si en un futuro se quisiera compartir incidentes entre las 3 réplicas, bastaría conectarlas a una misma base de datos PostgreSQL.

4. **`GET /metrics`** (`backend/src/metrics/`)
   Acá es donde el backend habla "idioma Prometheus". Usamos la librería `prom-client` con un `Registry` propio (`MetricsService`):
   - `collectDefaultMetrics`: expone automáticamente métricas internas de Node.js (uso de CPU del proceso, memoria heap, event loop lag, garbage collection).
   - **`http_requests_total` (Counter):** contador que solo sube. Lleva las etiquetas `method`, `route` y `status_code`. Sirve para calcular **requests por segundo (RPS)** y tasa de errores (`4xx`/`5xx`).
   - **`http_request_duration_seconds` (Histogram):** mide cuánto tardó cada petición y la clasifica en "baldes" (*buckets* de 5ms, 10ms, 25ms, ..., hasta 5s). Con esto Grafana calcula la **latencia p95** (el 95% de las peticiones fueron más rápidas que ese valor).
   - **`http_requests_in_flight` (Gauge):** indicador que sube cuando entra una petición y baja cuando termina (o se corta la conexión). Muestra cuántas peticiones simultáneas está atendiendo el backend en ese instante.

   **Cómo se capturan esas métricas sin ensuciar los controladores:**
   El middleware `HttpMetricsMiddleware` (`backend/src/metrics/http-metrics.middleware.ts`) intercepta todas las rutas (`*`), toma el tiempo inicial con `process.hrtime.bigint()`, suma 1 a `in_flight` y, cuando la respuesta termina (`res.on('finish')`), resta 1 y registra duración y conteo.
   - **Detalle de arquitectura muy bueno para mencionar:** para la etiqueta `route` usamos `req.route?.path` (ej. `/incidents/:id`) en lugar de `req.url` (que tendría millones de UUIDs distintos). Eso evita el problema de **alta cardinalidad** en Prometheus (que explotaría la memoria creando una serie nueva por cada UUID).

### 3.2 Cómo funciona el `Dockerfile` (`backend/Dockerfile`)

Usa un **build multi-stage** sobre `node:22-alpine`:
1. **Etapa 1 (`builder`):** instala todas las dependencias (incluidas las de desarrollo como TypeScript y Nest CLI) y compila el proyecto a JavaScript en `dist/`.
2. **Etapa 2 (`production`):** parte de una imagen limpia `node:22-alpine`, instala solo dependencias de producción (`npm ci --omit=dev`), copia `dist/` desde la etapa anterior y ejecuta `node dist/main.js` escuchando en `0.0.0.0:3000`.
   - **Por qué `0.0.0.0` y no `localhost`:** dentro de un contenedor, `localhost` solo acepta conexiones del mismo contenedor; `0.0.0.0` permite que Nginx (desde otro contenedor de la red Docker) pueda conectarse.
   - **Por qué `USER node`:** por seguridad, el proceso Node no corre como `root` dentro del contenedor.

---

## 4. Nginx como Proxy Inverso y Balanceador (`nginx/nginx.conf`)

Nginx cumple dos funciones en el mismo archivo:

1. **Proxy inverso + Balanceador de carga (puerto `80` → mapeado al `8080` de tu Mac):**
   ```nginx
   upstream incident_backends {
       server backend-1:3000;
       server backend-2:3000;
       server backend-3:3000;
   }
   ```
   Como no indicamos otro algoritmo, Nginx usa **Round-Robin** por defecto: petición 1 → `backend-1`, petición 2 → `backend-2`, petición 3 → `backend-3`, petición 4 → vuelve a `backend-1`.
   Además reenvía encabezados (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) para que el backend sepa cuál fue la IP y el protocolo original del cliente.

2. **Endpoint de estado interno `stub_status` (puerto `8081`):**
   Habilitamos `location /nginx_status` con el módulo `stub_status`, pero en un bloque `server` separado que escucha en el puerto `8081` (el cual **no** se publica en `docker-compose.yml`) y además restringido a IPs privadas (`127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
   - **Por qué en el puerto `8081` y no en el `80`:** si lo dejábamos en el `80`, cualquiera en `http://localhost:8080/nginx_status` podría ver estadísticas internas del servidor. Al separarlo al `8081` sin mapearlo al host, solo `nginx-exporter` (desde adentro de `monitoring-net`) y el propio `healthcheck` de Nginx pueden leerlo.

---

## 5. Los Exportadores (`nginx-exporter` y `cadvisor`)

Ni Nginx ni el motor de Docker entregan métricas en formato Prometheus por sí solos. Para eso existen los **exporters** (traductores):

1. **`nginx-exporter` (`nginx/nginx-prometheus-exporter:1.4.0`):**
   - Cada vez que Prometheus le pide métricas en el puerto `9113`, `nginx-exporter` consulta `http://nginx:8081/nginx_status`, lee el texto plano de `stub_status` (conexiones activas, aceptadas, manejadas, reading, writing, waiting) y lo convierte en métricas Prometheus (`nginx_connections_active`, `nginx_http_requests_total`, etc.).

2. **`cadvisor` (`gcr.io/cadvisor/cadvisor:v0.49.1`):**
   - Es una herramienta de Google que observa directamente los contenedores corriendo en el host Docker.
   - Monta carpetas del sistema (`/`, `/var/run`, `/sys`, `/var/lib/docker`, `/dev/disk`) en modo solo lectura (`:ro`) y corre con `privileged: true` para poder leer los contadores de CPU, memoria RAM, tráfico de red y disco de cada contenedor, exponiéndolos en el puerto interno `8080`.
   - *(Nota para tu Mac: como usás Colima, Docker corre dentro de una VM Linux ARM64; por eso cAdvisor funciona bien, aunque algunas métricas de disco pueden variar respecto a un Linux físico nativo).*

---

## 6. Prometheus (`prometheus/prometheus.yml`)

Prometheus es una **base de datos de series de tiempo** (*TSDB*) que funciona con modelo **pull**: él mismo va a buscar (*scrape*) las métricas a cada servicio cada `15s` (`scrape_interval: 15s`).

En `prometheus.yml` tiene 4 trabajos (*jobs*):
- `prometheus`: se monitorea a sí mismo (`localhost:9090`).
- `backend`: consulta `/metrics` en `backend-1:3000`, `backend-2:3000` y `backend-3:3000`.
- `nginx-exporter`: consulta `nginx-exporter:9113`.
- `cadvisor`: consulta `cadvisor:8080`.

Sus datos históricos se guardan en el volumen nombrado `prometheus_data` (`/prometheus`) para que no se pierdan si reiniciás el contenedor.

---

## 7. Grafana (`grafana/provisioning/`)

Grafana es la capa de **visualización**. En lugar de obligarte a configurar todo a mano desde la web cada vez que levantás el proyecto, usamos **Provisioning automático**:
- `grafana/provisioning/datasources/datasource.yml`: al arrancar, Grafana crea automáticamente la conexión a Prometheus (`http://prometheus:9090`).
- `grafana/provisioning/dashboards/dashboard.yml`: le dice a Grafana que lea todos los `.json` de esa carpeta y los cargue como tableros listos para usar:
  1. **`Incident API - Overview` (`overview.json`):**
     - *Targets UP:* usa `up` (1 = vivo, 0 = caído).
     - *Request Rate per Instance:* `sum(rate(http_requests_total[1m])) by (instance)` (peticiones por segundo que atiende cada backend).
     - *p95 Latency:* `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, instance))` (el 95% de las peticiones responden por debajo de ese tiempo).
     - *HTTP Status Codes:* `sum(rate(http_requests_total[1m])) by (status_code)`.
     - *In-flight Requests:* `http_requests_in_flight`.
  2. **`Docker Containers (cAdvisor)` (`containers.json`):**
     - Uso de CPU, memoria RAM y tráfico de red (recibido/enviado) por contenedor.
  3. **`Nginx Load Balancer` (`nginx.json`):**
     - Conexiones activas (`reading`, `writing`, `waiting`), conexiones aceptadas/manejadas y peticiones por segundo en Nginx.

La configuración de usuario/estado de Grafana se persiste en el volumen `grafana_data`.

---

## 8. Orden de arranque y Healthchecks (`docker-compose.yml`)

No usamos `depends_on` simple a ciegas:
- `backend-1`, `backend-2` y `backend-3` tienen un `healthcheck` que hace `fetch('http://127.0.0.1:3000/health')`.
- `nginx` espera con `condition: service_healthy` a los 3 backends antes de arrancar. Así evitamos que Nginx arranque antes que NestJS y devuelva errores `502 Bad Gateway` en los primeros segundos.
- `nginx-exporter` espera con `condition: service_healthy` a que Nginx responda en `http://127.0.0.1:8081/nginx_status`.

---

## 9. Pruebas de carga con k6 (`tests/load-test.js`) y prueba de caída

### 9.1 Cómo funciona `tests/load-test.js`
Cuando corrés `k6 run tests/load-test.js`:
1. Sube gradualmente de **0 a 10** usuarios virtuales en 15s, luego a **25** usuarios durante 30s, y baja a **0** en 15s (1 minuto total).
2. Cada usuario virtual ejecuta en bucle:
   - `GET /` (verifica status 200 y que venga `instanceId`).
   - `POST /incidents` (crea un incidente JSON y verifica status 201 y que devuelva `id`).
   - `GET /incidents` (lista incidentes y verifica que sea un array).
3. Evalúa dos umbrales (*thresholds*) automáticos:
   - `http_req_failed < 1%` (menos del 1% de fallos).
   - `http_req_duration p(95) < 500ms` (el 95% de las requests deben tardar menos de medio segundo).

### 9.2 Prueba de caída y recuperación (muy buena para la demo)
1. Mostrás con `curl` que responden `backend-1`, `backend-2` y `backend-3`.
2. Detenés una instancia: `docker-compose stop backend-2`.
3. En Prometheus (*Targets*) vas a ver `backend-2:3000` pasar a `DOWN` (y en Grafana baja a 0 su línea de RPS), mientras Nginx sigue sirviendo tráfico con `backend-1` y `backend-3` (puede mostrar algún error transitorio mientras Nginx detecta el fallo en su upstream, lo cual es un comportamiento real de Nginx OSS).
4. La volvés a levantar: `docker-compose start backend-2` y mostrás cómo vuelve a `UP` y retoma tráfico.

---

## 10. Guion rápido para tu demo en vivo (checklist)

1. `docker-compose ps` → mostrar los 8 contenedores `Up` y `healthy`.
2. `for i in $(seq 1 9); do curl -s http://localhost:8080/; echo; done` → mostrar el balanceo round-robin (`backend-1`, `backend-2`, `backend-3`).
3. Abrir `http://localhost:9090/targets` → mostrar todos los targets `UP`.
4. Abrir `http://localhost:3000` → mostrar los 3 dashboards ya cargados.
5. Correr `k6 run tests/load-test.js` (si instalás `k6` con `brew install k6`) y ver en vivo cómo suben las curvas de RPS, CPU y conexiones en Grafana.
6. *(Opcional)* Parar `backend-2` y volverlo a iniciar para demostrar observabilidad ante fallos.

---

## 11. Preguntas típicas que te puede hacer el profesor (y cómo responder)

- **¿Por qué usaron `nginx-exporter` y no conectaron Prometheus directo a Nginx?**
  Porque Nginx `stub_status` devuelve un texto plano simple, no el formato de métricas con etiquetas que entiende Prometheus. El exporter traduce ese estado al formato Prometheus en `/metrics`.
- **¿Cómo evitan que las métricas de `/incidents/:id` exploten la memoria de Prometheus?**
  En el middleware de NestJS usamos el patrón de ruta (`req.route?.path`, o sea `/incidents/:id`) en lugar de la URL real con el UUID. Eso mantiene la cardinalidad controlada.
- **¿Por qué pusieron `/nginx_status` en el puerto `8081`?**
  Para aislarlo de la red pública: solo el puerto `80` (API) se expone al host en `8080`; el `8081` queda únicamente accesible dentro de la red interna `monitoring-net` para `nginx-exporter` y el healthcheck.
- **¿Qué pasa con los datos de Prometheus y Grafana si borro los contenedores?**
  Si hago `docker-compose down`, los volúmenes `prometheus_data` y `grafana_data` conservan los datos. Solo se borran si agrego explícitamente `-v` (`docker-compose down -v`).
- **¿Tener 3 réplicas significa alta disponibilidad total?**
  Permite repartir carga y tolerar la caída de una instancia de backend, pero Nginx sigue siendo un único punto de entrada en esta arquitectura y los datos en memoria no se replican entre instancias (para producción real se agregaría base de datos compartida y múltiples proxies/orquestador).
