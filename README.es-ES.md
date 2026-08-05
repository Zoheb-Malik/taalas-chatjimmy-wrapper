# Taalas ChatJimmy AI OpenAI-Compatible Wrapper (No oficial)

Ligero wrapper compatible con OpenAI para `https://chatjimmy.ai` de Taalas (`llama3.1-8B`).
Úsalo para apuntar integraciones existentes de SDK/cliente de OpenAI sin reescribir llamadas a la API.

<p align="center">
  <img src="https://taalas.com/h-content/uploads/2026/02/graph.png" alt="Performance graph" width="500" />
</p>

## Aviso

- Proyecto comunitario; no oficial.
- No afiliado, respaldado ni patrocinado por Taalas o ChatJimmy.
- La compatibilidad es mejor esfuerzo.

## Características

- Endpoints con estilo OpenAI:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Completados con streaming y sin streaming
- Validación de solicitudes y formato de error estilo OpenAI
- Autenticación opcional del wrapper con `WRAPPER_API_KEY`
- Limitaciones configurables de carga útil/herramientas

## Requisitos

- Node.js 20+
- pnpm

## Inicio Rápido

1. Instalar:

```bash
pnpm install
```

2. Crear `.env`:

```bash
UPSTREAM_BASE_URL=https://chatjimmy.ai
UPSTREAM_API_KEY=
EXPERIMENTAL_TOOL_USAGE=false
UPSTREAM_TIMEOUT_MS=15000
UPSTREAM_MAX_RETRIES=2
HOST=127.0.0.1
PORT=8787
DEFAULT_STREAM=false
WRAPPER_API_KEY=local-wrapper-key
BODY_LIMIT_MB=25
UPSTREAM_PREFILL_TOKEN_LIMIT=6064
UPSTREAM_REQUEST_BYTE_LIMIT=1200000
```

3. Iniciar:

```bash
pnpm server:start
```

4. Verificar salud:

```bash
curl -sS http://127.0.0.1:8787/health
```

Resultado esperado:

```json
{ "ok": true }
```

## Uso

Configurar variables de entorno:

```bash
export BASE_URL="http://127.0.0.1:8787"
export API_KEY="local-wrapper-key"
```

Listar modelos:

```bash
curl -sS \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/models" | jq
```

Completado de chat (no stream):

```bash
curl -sS \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "model":"llama3.1-8B",
    "messages":[{"role":"user","content":"Say hello in one sentence."}]
  }' \
  "$BASE_URL/v1/chat/completions" | jq
```

Completado de chat (stream):

```bash
curl -sS -N \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "model":"llama3.1-8B",
    "stream":true,
    "messages":[{"role":"user","content":"Count from 1 to 3."}]
  }' \
  "$BASE_URL/v1/chat/completions"
```

Ejecutar ejemplos incluidos:

```bash
pnpm examples:curl:all
pnpm examples:node
pnpm examples:python
```

## Valores Predeterminados y Comportamiento

- `stream` usa el valor de `DEFAULT_STREAM` cuando no se especifica.
- Si `WRAPPER_API_KEY` está configurado, se requiere `Authorization: Bearer <clave>`.
- Si `UPSTREAM_API_KEY` está configurado, se usa para solicitudes al servidor superior.
- Con `EXPERIMENTAL_TOOL_USAGE=false`, los campos de herramienta se eliminan antes de enviar.
- `tool_choice: "required"` devuelve `400` cuando las herramientas están deshabilitadas.

## Scripts

- `pnpm start` - Iniciar servidor
- `pnpm check` - Typecheck + pruebas
- `pnpm typecheck` - Solo verificación de tipos TypeScript
- `pnpm test` - Suite de pruebas
- `pnpm test:tools` - Pruebas enfocadas en herramientas

## Solución de Problemas

- `401 Missing bearer token`: configurar encabezado o desconfigurar `WRAPPER_API_KEY`.
- `413 Request body is too large`: reducir la carga útil o aumentar `BODY_LIMIT_MB`.
- `422 Upstream returned an empty response`: reducir el tamaño del contexto o bajar `UPSTREAM_PREFILL_TOKEN_LIMIT`.
- `400 Tool usage is disabled`: configurar `EXPERIMENTAL_TOOL_USAGE=true` y reiniciar.

## Contribuir

- Ver `docs/CONTRIBUTING.md`.
- Reportar vulnerabilidades vía `docs/SECURITY.md`.
