FROM node:24-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
ARG MARKET_STACK_API_INTERNAL_URL=http://backend:8000/api/v1
ARG BUILD_SHA=local
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    MARKET_STACK_API_INTERNAL_URL=$MARKET_STACK_API_INTERNAL_URL \
    NEXT_DEPLOYMENT_ID=$BUILD_SHA

COPY package*.json ./
RUN npm ci

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/ananta-market-stack-frontend-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/ananta-market-stack-frontend-entrypoint \
    && chmod +x /usr/local/bin/ananta-market-stack-frontend-entrypoint \
    && BETTER_AUTH_SECRET=ananta-market-stack-build-time-placeholder AUTH_DATABASE_PATH=/tmp/ananta-market-stack-build-auth.db npm run build

FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /usr/local/bin/ananta-market-stack-frontend-entrypoint /usr/local/bin/ananta-market-stack-frontend-entrypoint
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

ENTRYPOINT ["ananta-market-stack-frontend-entrypoint"]
CMD ["node", "server.js"]
