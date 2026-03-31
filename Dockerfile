FROM node:22.19.0-slim AS test
WORKDIR /usr/pkg/
COPY package*.json ./
RUN npm ci
COPY . .
RUN chown -R node:node /usr/pkg/
USER node
ENV NODE_ENV=test
CMD ["npm", "run", "docker:test"]
