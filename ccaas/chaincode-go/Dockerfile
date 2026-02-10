# Build stage
FROM golang:1.23.0-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git gcc musl-dev

# Set working directory
WORKDIR /chaincode

# Copy go.mod and go.sum
COPY go.mod go.sum ./

# Download dependencies with retry logic
RUN for i in {1..3}; do \
      go mod download && break || \
      ([ $i -lt 3 ] && echo "Retry $i/3, retrying in 5s..." && sleep 5); \
    done

# Copy the source code
COPY . .

# Build the chaincode
RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o chaincode .
# RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o chaincode ./chaincode


# Runtime stage
FROM alpine:latest

# Install ca-certificates for TLS
RUN apk --no-cache add ca-certificates

# Set working directory
WORKDIR /root/

# Copy the built binary from builder
COPY --from=builder /chaincode/chaincode .

# Expose the chaincode server port
EXPOSE 9999

# Set the entrypoint
CMD ["./chaincode"]
