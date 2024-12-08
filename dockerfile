FROM node:22
WORKDIR /usr/pkg/
COPY . .
RUN npm ci
CMD npm run docker:test
