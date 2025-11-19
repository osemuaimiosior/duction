# # Use the official Node.js runtime as base image
# FROM node:18-alpine

# # Install PostgreSQL client tools for pg_isready
# RUN apk add --no-cache postgresql-client

# # Set the working directory inside the container
# WORKDIR /app

# # Copy package.json and package-lock.json (if available)
# COPY package*.json ./

# # Install dependencies
# RUN npm ci && npm cache clean --force
# #RUN npm ci --only=production && npm cache clean --force

# # Copy the rest of the application code
# COPY . .

# # Copy environment file
# COPY .env .env

# # Copy the entrypoint script
# COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# # Make the entrypoint executable
# RUN chmod +x /usr/local/bin/entrypoint.sh

# # Create a non-root user to run the application
# RUN addgroup -g 1001 -S nodejs && \
#     adduser -S nextjs -u 1001

# # Change ownership of the app directory to the nodejs user
# RUN chown -R nextjs:nodejs /app
# USER nextjs

# # Expose port 5600 (or use PORT env var)
# EXPOSE 5600


# # Use entrypoint to run migrations/seeds and then start app
# ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# -----------------------------
# Base image
# -----------------------------
FROM node:18-alpine

# -----------------------------
# Install required Alpine tools
# -----------------------------
RUN apk add --no-cache bash postgresql-client ca-certificates jq

# -----------------------------
# Copy pre-downloaded binaries for kind and kubectl
# -----------------------------
# Make sure you have downloaded these on your host:
#   kind:   https://kind.sigs.k8s.io/dl/v0.30.0/kind-linux-amd64
#   kubectl: https://dl.k8s.io/release/v1.29.6/bin/linux/amd64/kubectl
COPY kubectl /usr/local/bin/kubectl

RUN chmod +x /usr/local/bin/kubectl

# -----------------------------
# Set working directory
# -----------------------------
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci && npm cache clean --force

# Copy rest of application
COPY . .

# Copy environment and entrypoint
COPY .env .env
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# -----------------------------
# Create non-root user
# -----------------------------
RUN addgroup -g 1001 -S nodejs \
 && adduser -S nextjs -u 1001 \
 && chown -R nextjs:nodejs /app

USER nextjs
ENV HOME=/home/nextjs

# -----------------------------
# Expose app port
# -----------------------------
EXPOSE 5600

# -----------------------------
# Entrypoint
# -----------------------------
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
