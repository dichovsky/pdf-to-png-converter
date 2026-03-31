FROM node:22.19.0-slim
WORKDIR /usr/pkg/
COPY . .
RUN npm ci
CMD ["npm", "run", "docker:test"]
