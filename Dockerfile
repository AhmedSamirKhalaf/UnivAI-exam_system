# syntax=docker/dockerfile:1
#
# Independent, multi-stage build for the Exam service.
#
# The Exam service does NOT depend on the UnivAI app or Core repos at build or
# run time. It only needs Node and a MongoDB connection string, supplied via
# the MONGODB_URI environment variable at run time.

# ---- Stage 1: dependencies ------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: build --------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A valid placeholder URI is required so the db module can be imported during
# `next build`; the real value is injected at run time.
ARG MONGODB_URI=mongodb://mongo:27017/univai_exams
ENV MONGODB_URI=$MONGODB_URI
RUN npm run build

# ---- Stage 3: runner -------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3200
ENV EXAM_HOST=0.0.0.0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/next-env.d.ts ./next-env.d.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/docker-compose.standalone.yml ./docker-compose.standalone.yml
EXPOSE 3200
# Non-root user for production.
USER node
CMD ["npm", "run", "start"]
