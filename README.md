# Docker Monitoring Project

Stack de infraestructura y observabilidad con Docker Compose para una API de gestión de incidentes en NestJS balanceada con Nginx y monitoreada con Prometheus, cAdvisor, Nginx Exporter y Grafana.

## Prerrequisitos

- [Docker](https://docs.docker.com/get-docker/) y Docker Compose (`docker compose` o `docker-compose`).
- [k6](https://k6.io/docs/get-started/installation/) (opcional, para ejecutar pruebas de carga).
- `curl` para verificaciones rápidas desde la terminal.

## Arquitectura

```text
Cliente HTTP
   │
   ▼
Nginx (Puerto 8080 -> 80)  ──► /nginx_status ──► nginx-exporter (:9113)
   │                                                      │
   ├──► backend-1 (:3000) ──► /metrics ───────────────────┤
   ├──► backend-2 (:3000) ──► /metrics ───────────────────┼──► Prometheus (:9090) ──► Grafana (:3000)
   └──► backend-3 (:3000) ──► /metrics ───────────────────┤
                                                          │
cAdvisor (:8080 interno) ─────────────────────────────────┘
```

Todos los servicios se comunican a través de la red bridge `monitoring-net`. Prometheus y Grafana persisten sus datos en los volúmenes `prometheus_data` y `grafana_data`.

## Configuración inicial (`.env`)

Antes de levantar los contenedores, copie el archivo de ejemplo de variables de entorno:

```bash
cp .env.example .env
```

Puede ajustar en `.env` los puertos expuestos (`NGINX_PORT`, `PROMETHEUS_PORT`, `GRAFANA_PORT`) y las credenciales de Grafana (`GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD`).

## Levantar el stack

Con Docker Compose v2:

```bash
docker compose up -d --build
```

Si utiliza Docker Compose v1 (`docker-compose`):

```bash
docker-compose up -d --build
```

Verifique que todos los servicios estén en estado `running` / `healthy`:

```bash
docker compose ps
```

## URLs de acceso

- **API (vía Nginx Load Balancer):** `http://localhost:8080`
- **Prometheus:** `http://localhost:9090`
- **Grafana:** `http://localhost:3000` (usuario/contraseña por defecto: `admin` / `admin`)

## Verificación de balanceo de carga

Realice varias peticiones consecutivas al endpoint raíz de la API para comprobar el balanceo round-robin entre `backend-1`, `backend-2` y `backend-3`:

```bash
for i in {1..6}; do curl -s http://localhost:8080/ && echo ""; done
```

Cada respuesta incluirá el campo `instanceId` rotando entre las tres réplicas.

## Verificación de métricas y Grafana

1. **Targets en Prometheus:** ingrese a `http://localhost:9090/targets` y confirme que los jobs `prometheus`, `backend` (3 instancias), `nginx-exporter` y `cadvisor` aparezcan en estado **UP**.
2. **Dashboards en Grafana:** ingrese a `http://localhost:3000`, diríjase a **Dashboards** y verifique los tres tableros aprovisionados automáticamente:
   - **Incident API - Overview** (`overview.json`): estado de targets, tasa de peticiones por instancia, latencia p95, códigos HTTP y peticiones en curso.
   - **Docker Containers (cAdvisor)** (`containers.json`): uso de CPU, memoria y red RX/TX por contenedor.
   - **Nginx Load Balancer** (`nginx.json`): conexiones activas, aceptadas/atendidas y peticiones por segundo.

## Pruebas de carga con k6

Con el stack en ejecución, lance el script de prueba contra `http://localhost:8080`:

```bash
k6 run tests/load-test.js
```

El script ejecuta peticiones `GET /`, `POST /incidents` y `GET /incidents` con validaciones (`checks`) y umbrales (`thresholds`) de tasa de error `< 1%` y latencia `p(95) < 500ms`.

## Apagado y limpieza

Para detener y eliminar los contenedores manteniendo los volúmenes de datos:

```bash
docker compose down
```

Para eliminar también los volúmenes (`prometheus_data` y `grafana_data`):

```bash
docker compose down -v
```
