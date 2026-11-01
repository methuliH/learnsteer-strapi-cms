# Custom Strapi image (there is no maintained official Strapi Docker image).
# Secrets (APP_KEYS, API_TOKEN_SALT, ADMIN_JWT_SECRET, TRANSFER_TOKEN_SALT,
# JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL ...) are passed at runtime with
# `docker run --env-file` or your host's env settings. They are never baked
# into the image; .env is excluded by .dockerignore.

FROM node:22-alpine AS build
RUN apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev git
WORKDIR /opt/app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache vips-dev
WORKDIR /opt/app
ENV NODE_ENV=production
# --chown on the copy avoids a separate `chown -R` layer (which duplicated
# node_modules and took ~7 minutes). public/uploads is excluded by
# .dockerignore, but the local upload provider refuses to start without it.
COPY --from=build --chown=node:node /opt/app ./
RUN mkdir -p public/uploads && chown node:node public/uploads
USER node
EXPOSE 1337
CMD ["npm", "run", "start"]
