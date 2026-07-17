ARG BUILD_SHA=local

FROM node:24-slim AS frontend-builder

WORKDIR /app/frontend

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_BASE_URL=/api/v1
ARG MARKET_STACK_API_INTERNAL_URL=http://127.0.0.1:8000/api/v1
ARG BUILD_SHA
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    MARKET_STACK_API_INTERNAL_URL=$MARKET_STACK_API_INTERNAL_URL \
    NEXT_DEPLOYMENT_ID=$BUILD_SHA

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN BETTER_AUTH_SECRET=ananta-market-stack-build-time-placeholder \
    AUTH_DATABASE_PATH=/tmp/ananta-market-stack-build-auth.db \
    npm run build

FROM python:3.12-slim AS backend-builder

WORKDIR /app/backend

COPY backend/requirements.txt ./
ENV PIP_DEFAULT_TIMEOUT=100 \
    PIP_RETRIES=10 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && grep -v '^winloop==' requirements.txt > requirements-linux.txt \
    && ( \
         /opt/venv/bin/pip install --no-cache-dir --prefer-binary -r requirements-linux.txt \
         || (echo "pip install failed (attempt 1/5), retrying..." && sleep 5 \
             && /opt/venv/bin/pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
         || (echo "pip install failed (attempt 2/5), retrying..." && sleep 10 \
             && /opt/venv/bin/pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
         || (echo "pip install failed (attempt 3/5), retrying..." && sleep 15 \
             && /opt/venv/bin/pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
         || (echo "pip install failed (attempt 4/5), retrying..." && sleep 20 \
             && /opt/venv/bin/pip install --no-cache-dir --prefer-binary -r requirements-linux.txt) \
       )

FROM python:3.12-slim AS runtime

ARG BUILD_SHA
ARG BUILD_VERSION=
ARG BUILD_DATE=

LABEL org.opencontainers.image.title="Ananta Market Stack" \
    org.opencontainers.image.description="Self-hosted trading and market-data workspace." \
    org.opencontainers.image.source="https://github.com/manasijatech/ananta-market-stack" \
    org.opencontainers.image.revision="${BUILD_SHA}" \
    org.opencontainers.image.version="${BUILD_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    PATH="/opt/venv/bin:$PATH" \
    MARKET_STACK_BUILD_SHA="${BUILD_SHA}" \
    MARKET_STACK_BUILD_VERSION="${BUILD_VERSION}" \
    DESKTOP_AUDIO_STORAGE_DIR="/data/alert-audio"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends redis-server nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=frontend-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=backend-builder /opt/venv /opt/venv
COPY backend /app/backend
COPY --from=frontend-builder /app/frontend/.next/standalone /app/frontend
COPY --from=frontend-builder /app/frontend/.next/static /app/frontend/.next/static
COPY --from=frontend-builder /app/frontend/public /app/frontend/public
COPY docker/ananta-market-stack-entrypoint.sh /usr/local/bin/ananta-market-stack

RUN printf '{"sha":"%s","version":"%s","built_at":"%s"}\n' \
        "$BUILD_SHA" "$BUILD_VERSION" "$BUILD_DATE" > /app/BUILD_INFO.json

RUN sed -i 's/\r$//' /usr/local/bin/ananta-market-stack \
    && chmod +x /usr/local/bin/ananta-market-stack \
    && mkdir -p /data \
    && rm -rf /app/backend/data \
    && ln -s /data /app/backend/data

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=3).read(); urllib.request.urlopen('http://127.0.0.1:3001/api/health', timeout=3).read(); urllib.request.urlopen('http://127.0.0.1:3000/api/health', timeout=3).read()"

ENTRYPOINT ["ananta-market-stack"]
