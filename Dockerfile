FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --create-home --shell /usr/sbin/nologin app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src ./src
USER app
EXPOSE 8080
CMD ["node", "src/index.ts"]
