FROM node:current-buster-slim

WORKDIR /usr/pkg/
COPY . .

RUN npm ci

CMD npm run docker:test
