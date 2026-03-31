FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli
COPY package.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data tokens
EXPOSE 3000
CMD ["node", "server.js"]
