# Builder stage
FROM golang:1.23.0-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o main main.go 

# Final stage
FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app

# Copy the binary as 'main'
COPY --from=builder /app/main .

CMD ["./main"]