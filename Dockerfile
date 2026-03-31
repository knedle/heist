FROM node:22-alpine
WORKDIR /app
COPY server.js index.html CurrencyRerollRare.png ./
CMD ["node", "server.js"]
