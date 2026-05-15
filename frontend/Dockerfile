FROM node:22-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_APP_URL=http://localhost:3001
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8004/api/v1
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY package*.json ./
RUN npm ci

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/market-stack-frontend-entrypoint
RUN chmod +x /usr/local/bin/market-stack-frontend-entrypoint \
    && BETTER_AUTH_SECRET=market-stack-build-time-placeholder AUTH_DATABASE_PATH=/tmp/market-stack-build-auth.db npm run build

ENV NODE_ENV=production

EXPOSE 3001

ENTRYPOINT ["market-stack-frontend-entrypoint"]
CMD ["npm", "run", "start", "--", "-p", "3001", "-H", "0.0.0.0"]
