# Relay (+ optional static game). Build the wasm first: npm run build
# Relay only:    docker run -e SERVE_STATIC=0 -e ALLOWED_ORIGINS=https://your.site -p 8081:8081 ...
# All-in-one:    docker run -p 8081:8081 ...   (serves web/ and /ws)
FROM node:22-alpine
ENV NODE_ENV=production PORT=8081
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/relay.mjs server/
COPY web web
USER node
EXPOSE 8081
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1
CMD ["node", "server/relay.mjs"]
