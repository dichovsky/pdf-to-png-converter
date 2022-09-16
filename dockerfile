FROM node:16
WORKDIR /usr/pkg/
COPY . .

RUN npm ci

CMD npm run docker:test
