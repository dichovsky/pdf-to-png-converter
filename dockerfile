FROM node:22.17.0
WORKDIR /usr/pkg/
COPY . .
RUN npm ci
CMD ["npm", "run", "docker:test"]
