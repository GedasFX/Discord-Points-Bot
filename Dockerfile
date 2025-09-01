FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .
RUN mv scripts/register.sh ./register

VOLUME [ "/app/data" ]
USER 1000

ENTRYPOINT ["node", "index.js"]