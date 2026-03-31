FROM node:22.19.0-slim
WORKDIR /usr/pkg/
COPY . .
RUN npm ci
RUN chown -R node:node /usr/pkg/
USER node
CMD ["npm", "run", "docker:test"]
