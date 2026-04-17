# Use a stable Node version
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first for better caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . ./
COPY .env ./

# Use production mode by default
ENV NODE_ENV=production

# Expose the application port used by index.js
EXPOSE 3000

# Run the main server process
CMD ["node", "index.js"]
