FROM node:24-slim AS frontend-builder

WORKDIR /app/frontend

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_BASE_URL=/api/v1
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN BETTER_AUTH_SECRET=market-stack-build-time-placeholder \
    AUTH_DATABASE_PATH=/tmp/market-stack-build-auth.db \
    npm run build \
    && npm prune --omit=dev

FROM python:3.12-slim AS backend-builder

WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && grep -v '^winloop==' requirements.txt > requirements-linux.txt \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements-linux.txt

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends redis-server ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=frontend-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=backend-builder /opt/venv /opt/venv
COPY backend /app/backend
COPY --from=frontend-builder /app/frontend /app/frontend
COPY docker/market-stack-entrypoint.sh /usr/local/bin/market-stack

RUN sed -i 's/\r$//' /usr/local/bin/market-stack \
    && chmod +x /usr/local/bin/market-stack \
    && mkdir -p /data \
    && rm -rf /app/backend/data \
    && ln -s /data /app/backend/data

VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["market-stack"]
