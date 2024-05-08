# syntax=docker/dockerfile:1

FROM node:21

USER root
WORKDIR /home/node/app
COPY package*.json ./
RUN npm install
COPY . .

RUN mkdir -p ./persist/{databases,userfiles,uploads}


CMD ["bash", "-c", "scripts/start.sh"]
EXPOSE 3000
EXPOSE 3001
