FROM node:16.15.0-slim

WORKDIR /usr/pkg/
COPY . .

RUN npm ci

CMD npm run docker:test
