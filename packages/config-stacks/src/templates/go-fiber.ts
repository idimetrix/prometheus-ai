import type { ProjectTemplate, ScaffoldFile } from "./types";

function scaffoldFiles(projectName: string): ScaffoldFile[] {
  const goModule = `github.com/user/${projectName}`;
  return [
    {
      path: "go.mod",
      content: `module ${goModule}

go 1.23

require (
\tgithub.com/gofiber/fiber/v2 v2.52.0
\tgithub.com/jackc/pgx/v5 v5.7.0
\tgithub.com/joho/godotenv v1.5.1
\tgithub.com/rs/zerolog v1.33.0
\tgithub.com/google/uuid v1.6.0
)
`,
    },
    {
      path: "cmd/server/main.go",
      content: `package main

import (
\t"log"
\t"os"

\t"github.com/gofiber/fiber/v2"
\t"github.com/gofiber/fiber/v2/middleware/cors"
\t"github.com/gofiber/fiber/v2/middleware/logger"
\t"github.com/gofiber/fiber/v2/middleware/recover"
\t"github.com/joho/godotenv"

\t"${goModule}/internal/handler"
)

func main() {
\t_ = godotenv.Load()

\tapp := fiber.New(fiber.Config{
\t\tAppName: "${projectName}",
\t})

\tapp.Use(logger.New())
\tapp.Use(recover.New())
\tapp.Use(cors.New())

\thandler.RegisterRoutes(app)

\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "4000"
\t}

\tlog.Fatal(app.Listen(":" + port))
}
`,
    },
    {
      path: "internal/handler/routes.go",
      content: `package handler

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App) {
\tapi := app.Group("/api")

\tapi.Get("/health", func(c *fiber.Ctx) error {
\t\treturn c.JSON(fiber.Map{"status": "ok"})
\t})

\tapi.Get("/hello", func(c *fiber.Ctx) error {
\t\tname := c.Query("name", "world")
\t\treturn c.JSON(fiber.Map{"greeting": "Hello " + name + "!"})
\t})
}
`,
    },
    {
      path: "internal/config/config.go",
      content: `package config

import "os"

type Config struct {
\tPort        string
\tDatabaseURL string
}

func Load() *Config {
\treturn &Config{
\t\tPort:        getEnv("PORT", "4000"),
\t\tDatabaseURL: getEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/${projectName}"),
\t}
}

func getEnv(key, fallback string) string {
\tif val := os.Getenv(key); val != "" {
\t\treturn val
\t}
\treturn fallback
}
`,
    },
    {
      path: "internal/model/user.go",
      content: `package model

import "time"

type User struct {
\tID        string    \`json:"id"\`
\tEmail     string    \`json:"email"\`
\tName      string    \`json:"name"\`
\tCreatedAt time.Time \`json:"created_at"\`
\tUpdatedAt time.Time \`json:"updated_at"\`
}
`,
    },
    {
      path: ".env.example",
      content: `PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${projectName}
`,
    },
    {
      path: ".gitignore",
      content: `bin/
tmp/
.env
*.exe
vendor/
`,
    },
    {
      path: "Dockerfile",
      content: `FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /server /server
EXPOSE 4000
ENTRYPOINT ["/server"]
`,
    },
    {
      path: "Makefile",
      content: `.PHONY: dev build test

dev:
\tgo run ./cmd/server

build:
\tgo build -o bin/server ./cmd/server

test:
\tgo test ./...
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

Go API built with **Fiber** web framework and **PostgreSQL**.

## Getting Started

\`\`\`bash
cp .env.example .env
go mod tidy
make dev          # http://localhost:4000
\`\`\`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| GET | /api/hello?name=x | Greeting |
`,
    },
  ];
}

export const GO_FIBER_TEMPLATE: ProjectTemplate = {
  id: "go-fiber",
  name: "Go Fiber API",
  description:
    "Go REST API with Fiber web framework, pgx PostgreSQL driver, and zerolog structured logging.",
  category: "Backend",
  techStack: ["Go", "Fiber", "pgx", "PostgreSQL"],
  languages: ["Go"],
  icon: "terminal",
  estimatedMinutes: 4,
  scaffoldFiles,
};
