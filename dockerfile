FROM node:22.19.0-slim AS test
WORKDIR /usr/pkg/
COPY package*.json ./
RUN npm ci
COPY . .
RUN chown -R node:node /usr/pkg/
USER node
CMD ["npm", "run", "docker:test"]
