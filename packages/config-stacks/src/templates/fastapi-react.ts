import type { ProjectTemplate, ScaffoldFile } from "./types";

function scaffoldFiles(projectName: string): ScaffoldFile[] {
  return [
    {
      path: "backend/requirements.txt",
      content: `fastapi>=0.115.0,<1.0.0
uvicorn[standard]>=0.32.0,<1.0.0
sqlalchemy>=2.0.0,<3.0.0
alembic>=1.14.0,<2.0.0
psycopg[binary]>=3.2.0,<4.0.0
pydantic>=2.10.0,<3.0.0
pydantic-settings>=2.6.0,<3.0.0
python-jose[cryptography]>=3.3.0,<4.0.0
passlib[bcrypt]>=1.7.0,<2.0.0
python-multipart>=0.0.18,<1.0.0
httpx>=0.28.0,<1.0.0
pytest>=8.0.0,<9.0.0
pytest-asyncio>=0.25.0,<1.0.0
ruff>=0.8.0,<1.0.0
`,
    },
    {
      path: "backend/pyproject.toml",
      content: `[project]
name = "${projectName}-backend"
version = "0.1.0"
requires-python = ">=3.12"

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.pytest.ini_options]
asyncio_mode = "auto"
`,
    },
    {
      path: "backend/app/__init__.py",
      content: "",
    },
    {
      path: "backend/app/main.py",
      content: `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings

app = FastAPI(title="${projectName}", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health_check():
    return {"status": "ok"}
`,
    },
    {
      path: "backend/app/core/__init__.py",
      content: "",
    },
    {
      path: "backend/app/core/config.py",
      content: `from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/${projectName}"
    secret_key: str = "change-me-in-production"
    frontend_url: str = "http://localhost:5173"

    model_config = {"env_file": ".env"}


settings = Settings()
`,
    },
    {
      path: "backend/app/core/database.py",
      content: `from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.database_url.replace("postgresql+psycopg", "postgresql+psycopg_async", 1))
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session
`,
    },
    {
      path: "backend/app/api/__init__.py",
      content: "",
    },
    {
      path: "backend/app/api/router.py",
      content: `from fastapi import APIRouter

api_router = APIRouter()


@api_router.get("/hello")
async def hello(name: str = "world"):
    return {"greeting": f"Hello {name}!"}
`,
    },
    {
      path: "frontend/package.json",
      content: JSON.stringify(
        {
          name: `${projectName}-frontend`,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "vite",
            build: "tsc -b && vite build",
            preview: "vite preview",
          },
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            "@tanstack/react-query": "^5.0.0",
            axios: "^1.7.0",
          },
          devDependencies: {
            typescript: "^5.7.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            vite: "^6.0.0",
            "@vitejs/plugin-react": "^4.0.0",
            tailwindcss: "^4.0.0",
            "@tailwindcss/vite": "^4.0.0",
          },
        },
        null,
        2
      ),
    },
    {
      path: "frontend/index.html",
      content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: "frontend/src/main.tsx",
      content: `import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
`,
    },
    {
      path: "frontend/src/App.tsx",
      content: `export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-bold text-4xl">${projectName}</h1>
      <p className="text-lg text-neutral-600">FastAPI + React app is ready.</p>
    </main>
  );
}
`,
    },
    {
      path: "frontend/src/index.css",
      content: `@import "tailwindcss";
`,
    },
    {
      path: "frontend/tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2
      ),
    },
    {
      path: "frontend/vite.config.ts",
      content: `import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
`,
    },
    {
      path: ".gitignore",
      content: `__pycache__/
*.pyc
.env
node_modules/
dist/
.vite/
`,
    },
    {
      path: "docker-compose.yml",
      content: `services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${projectName}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

Full-stack application with **FastAPI** backend and **React** + **Vite** frontend.

## Getting Started

\`\`\`bash
# Start PostgreSQL
docker compose up -d

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (in another terminal)
cd frontend
pnpm install
pnpm dev
\`\`\`
`,
    },
  ];
}

export const FASTAPI_REACT_TEMPLATE: ProjectTemplate = {
  id: "fastapi-react",
  name: "FastAPI + React",
  description:
    "FastAPI Python backend with React + Vite frontend, SQLAlchemy ORM, and Tailwind CSS.",
  category: "Full-Stack",
  techStack: ["FastAPI", "React", "SQLAlchemy", "Tailwind CSS", "Vite"],
  languages: ["Python", "TypeScript"],
  icon: "zap",
  estimatedMinutes: 8,
  scaffoldFiles,
};
