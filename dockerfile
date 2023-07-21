FROM node:20
WORKDIR /usr/pkg/
COPY . .
RUN apt-get update && apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
RUN npm ci

CMD npm run docker:test
