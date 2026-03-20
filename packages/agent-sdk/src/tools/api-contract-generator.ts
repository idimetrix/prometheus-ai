import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:api-contract-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAPISpec {
  info: {
    description: string;
    title: string;
    version: string;
  };
  openapi: string;
  paths: Record<string, Record<string, OpenAPIOperation>>;
}

export interface OpenAPIOperation {
  description: string;
  operationId: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    content: Record<string, { schema: Record<string, unknown> }>;
  };
  responses: Record<
    string,
    {
      content?: Record<string, { schema: Record<string, unknown> }>;
      description: string;
    }
  >;
  summary: string;
}

export interface OpenAPIParameter {
  in: "query" | "path" | "header";
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
}

export interface DataModel {
  fields: DataModelField[];
  name: string;
  relations: DataModelRelation[];
}

export interface DataModelField {
  name: string;
  nullable: boolean;
  type: string;
}

export interface DataModelRelation {
  relatedModel: string;
  type: "one-to-one" | "one-to-many" | "many-to-many";
}

export interface RouterFile {
  methods: RouterMethod[];
  path: string;
}

export interface RouterMethod {
  httpMethod: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  inputSchema?: Record<string, unknown>;
  name: string;
  outputSchema?: Record<string, unknown>;
}

export interface ContractValidation {
  errors: string[];
  missingEndpoints: string[];
  valid: boolean;
}

// ---------------------------------------------------------------------------
// APIContractGenerator
// ---------------------------------------------------------------------------

export class APIContractGenerator {
  generateOpenAPISpec(routerFiles: RouterFile[]): OpenAPISpec {
    logger.info({ routerCount: routerFiles.length }, "Generating OpenAPI spec");

    const paths: Record<string, Record<string, OpenAPIOperation>> = {};

    for (const router of routerFiles) {
      const pathOps: Record<string, OpenAPIOperation> = {};

      for (const method of router.methods) {
        const operation: OpenAPIOperation = {
          operationId: method.name,
          summary: method.name,
          description: `${method.httpMethod} ${router.path} — ${method.name}`,
          responses: {
            "200": {
              description: "Successful response",
              ...(method.outputSchema
                ? {
                    content: {
                      "application/json": { schema: method.outputSchema },
                    },
                  }
                : {}),
            },
            "400": { description: "Bad request" },
            "401": { description: "Unauthorized" },
            "500": { description: "Internal server error" },
          },
        };

        if (method.inputSchema) {
          operation.requestBody = {
            content: {
              "application/json": { schema: method.inputSchema },
            },
          };
        }

        pathOps[method.httpMethod.toLowerCase()] = operation;
      }

      paths[router.path] = pathOps;
    }

    return {
      openapi: "3.1.0",
      info: {
        title: "Prometheus API",
        version: "1.0.0",
        description: "Auto-generated API specification",
      },
      paths,
    };
  }

  generateGraphQLSchema(dataModels: DataModel[]): string {
    logger.info({ modelCount: dataModels.length }, "Generating GraphQL schema");

    const typeDefinitions = dataModels.map((model) => {
      const fields = model.fields.map((field) => {
        const gqlType = this.toGraphQLType(field.type);
        return `  ${field.name}: ${gqlType}${field.nullable ? "" : "!"}`;
      });

      for (const rel of model.relations) {
        if (rel.type === "one-to-many" || rel.type === "many-to-many") {
          fields.push(
            `  ${this.pluralize(rel.relatedModel)}: [${rel.relatedModel}!]!`
          );
        } else {
          fields.push(
            `  ${this.camelize(rel.relatedModel)}: ${rel.relatedModel}`
          );
        }
      }

      return `type ${model.name} {\n${fields.join("\n")}\n}`;
    });

    const queryFields = dataModels.map((model) => {
      const singular = this.camelize(model.name);
      const plural = this.pluralize(model.name);
      return `  ${singular}(id: ID!): ${model.name}\n  ${plural}: [${model.name}!]!`;
    });

    const queryType = `type Query {\n${queryFields.join("\n")}\n}`;

    return [...typeDefinitions, queryType].join("\n\n");
  }

  generateTypeScriptClient(spec: OpenAPISpec): string {
    logger.info("Generating TypeScript client");

    const lines: string[] = [
      "// Auto-generated API client",
      `// Generated from: ${spec.info.title} v${spec.info.version}`,
      "",
      "interface RequestOptions {",
      "  headers?: Record<string, string>;",
      "  signal?: AbortSignal;",
      "}",
      "",
      "export class APIClient {",
      "  constructor(private readonly baseUrl: string, private readonly defaultHeaders: Record<string, string> = {}) {}",
      "",
    ];

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const fnName = operation.operationId;
        const hasBody =
          method === "post" || method === "put" || method === "patch";

        const params: string[] = [];
        if (hasBody) {
          params.push("body: unknown");
        }
        params.push("options?: RequestOptions");

        lines.push(
          `  async ${fnName}(${params.join(", ")}): Promise<Response> {`
        );
        lines.push(`    return fetch(\`\${this.baseUrl}${path}\`, {`);
        lines.push(`      method: "${method.toUpperCase()}",`);
        lines.push(
          "      headers: { ...this.defaultHeaders, ...options?.headers },"
        );
        if (hasBody) {
          lines.push("      body: JSON.stringify(body),");
        }
        lines.push("      signal: options?.signal,");
        lines.push("    });");
        lines.push("  }");
        lines.push("");
      }
    }

    lines.push("}");

    return lines.join("\n");
  }

  validateContract(
    spec: OpenAPISpec,
    implementation: RouterFile[]
  ): ContractValidation {
    logger.info("Validating API contract");

    const errors: string[] = [];
    const missingEndpoints: string[] = [];

    for (const specPath of Object.keys(spec.paths)) {
      const impl = implementation.find((r) => r.path === specPath);
      if (!impl) {
        missingEndpoints.push(specPath);
      }
    }

    for (const router of implementation) {
      if (!spec.paths[router.path]) {
        errors.push(`Undocumented endpoint: ${router.path}`);
      }
    }

    return {
      valid: errors.length === 0 && missingEndpoints.length === 0,
      errors,
      missingEndpoints,
    };
  }

  private toGraphQLType(tsType: string): string {
    const mapping: Record<string, string> = {
      string: "String",
      number: "Float",
      boolean: "Boolean",
      integer: "Int",
      Date: "DateTime",
    };
    return mapping[tsType] ?? "String";
  }

  private camelize(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  private pluralize(str: string): string {
    const lower = this.camelize(str);
    if (lower.endsWith("s")) {
      return `${lower}es`;
    }
    if (lower.endsWith("y")) {
      return `${lower.slice(0, -1)}ies`;
    }
    return `${lower}s`;
  }
}
