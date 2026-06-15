# Le Vieillard — zero-dependency Node app
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8132
EXPOSE 8132
CMD ["node", "server.js"]
