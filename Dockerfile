# syntax=docker/dockerfile:1

FROM node:21
WORKDIR /app
COPY . .
RUN npm install
CMD ["bash", "-c", "scripts/run.sh"]
EXPOSE 3000
EXPOSE 3001
