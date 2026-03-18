import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:aws");

interface AwsCredentials {
  accessKeyId: string;
  region: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function parseAwsCredentials(
  credentials?: Record<string, string>
): MCPToolResult | AwsCredentials {
  const accessKeyId = credentials?.aws_access_key_id;
  const secretAccessKey = credentials?.aws_secret_access_key;
  const region = credentials?.aws_region ?? "us-east-1";

  if (!(accessKeyId && secretAccessKey)) {
    return {
      success: false,
      error:
        "AWS credentials required. Provide credentials.aws_access_key_id and credentials.aws_secret_access_key.",
    };
  }

  return {
    accessKeyId,
    secretAccessKey,
    region,
    sessionToken: credentials?.aws_session_token,
  };
}

/**
 * Create an AWS Signature V4 compatible request using fetch.
 * This is a simplified implementation; in production, use @aws-sdk/client-* packages.
 */
async function awsFetch(
  service: string,
  path: string,
  awsCreds: AwsCredentials,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: string,
  extraHeaders?: Record<string, string>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const host = `${service}.${awsCreds.region}.amazonaws.com`;
  const url = `https://${host}${path}`;

  const headers: Record<string, string> = {
    Host: host,
    "User-Agent": "Prometheus-MCP-Gateway/1.0",
    "X-Amz-Access-Key": awsCreds.accessKeyId,
    ...extraHeaders,
  };

  if (awsCreds.sessionToken) {
    headers["X-Amz-Security-Token"] = awsCreds.sessionToken;
  }

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn(
        { service, path, status: response.status },
        "AWS API request failed"
      );
      return {
        ok: false,
        data: null,
        error: `AWS ${service} error (${response.status}): ${text.slice(0, 500)}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    let data: unknown;
    if (contentType.includes("json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ service, path, error: message }, "AWS fetch failed");
    return { ok: false, data: null, error: message };
  }
}

export function registerAwsAdapter(registry: ToolRegistry): void {
  // ---- list_s3_buckets ----
  registry.register(
    {
      name: "aws_list_s3_buckets",
      adapter: "aws",
      description: "List all S3 buckets in the AWS account",
      inputSchema: {
        type: "object",
        properties: {},
      },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      const credsOrErr = parseAwsCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const result = await awsFetch("s3", "/", credsOrErr);

      if (!result.ok) {
        return {
          success: false,
          error: `AWS S3 error: ${result.error}`,
        };
      }

      return { success: true, data: result.data };
    }
  );

  // ---- get_s3_object ----
  registry.register(
    {
      name: "aws_get_s3_object",
      adapter: "aws",
      description: "Get an object from an S3 bucket",
      inputSchema: {
        type: "object",
        properties: {
          bucket: {
            type: "string",
            description: "S3 bucket name",
          },
          key: {
            type: "string",
            description: "Object key (path) within the bucket",
          },
        },
        required: ["bucket", "key"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = parseAwsCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { bucket, key } = input as { bucket: string; key: string };
      const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");

      const result = await awsFetch(
        "s3",
        `/${bucket}/${encodedKey}`,
        credsOrErr
      );

      if (!result.ok) {
        return {
          success: false,
          error: `AWS S3 error: ${result.error}`,
        };
      }

      return {
        success: true,
        data: { bucket, key, content: result.data },
      };
    }
  );

  // ---- put_s3_object ----
  registry.register(
    {
      name: "aws_put_s3_object",
      adapter: "aws",
      description: "Upload an object to an S3 bucket",
      inputSchema: {
        type: "object",
        properties: {
          bucket: {
            type: "string",
            description: "S3 bucket name",
          },
          key: {
            type: "string",
            description: "Object key (path) within the bucket",
          },
          content: {
            type: "string",
            description: "Content to upload (string or JSON)",
          },
          content_type: {
            type: "string",
            description:
              "MIME type of the content (default: application/octet-stream)",
          },
        },
        required: ["bucket", "key", "content"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = parseAwsCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { bucket, key, content, content_type } = input as {
        bucket: string;
        key: string;
        content: string;
        content_type?: string;
      };

      const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");
      const result = await awsFetch(
        "s3",
        `/${bucket}/${encodedKey}`,
        credsOrErr,
        "PUT",
        content,
        {
          "Content-Type": content_type ?? "application/octet-stream",
        }
      );

      if (!result.ok) {
        return {
          success: false,
          error: `AWS S3 error: ${result.error}`,
        };
      }

      return {
        success: true,
        data: { bucket, key, uploaded: true },
      };
    }
  );

  // ---- list_lambda_functions ----
  registry.register(
    {
      name: "aws_list_lambda_functions",
      adapter: "aws",
      description: "List all Lambda functions in the AWS account",
      inputSchema: {
        type: "object",
        properties: {
          max_items: {
            type: "number",
            description: "Maximum number of functions to return (max 50)",
          },
          marker: {
            type: "string",
            description: "Pagination marker from previous response",
          },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = parseAwsCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { max_items, marker } = input as {
        max_items?: number;
        marker?: string;
      };

      let path = "/2015-03-31/functions/";
      const params: string[] = [];
      if (max_items) {
        params.push(`MaxItems=${Math.min(max_items, 50)}`);
      }
      if (marker) {
        params.push(`Marker=${encodeURIComponent(marker)}`);
      }
      if (params.length > 0) {
        path += `?${params.join("&")}`;
      }

      const result = await awsFetch("lambda", path, credsOrErr);

      if (!result.ok) {
        return {
          success: false,
          error: `AWS Lambda error: ${result.error}`,
        };
      }

      return { success: true, data: result.data };
    }
  );

  // ---- invoke_lambda ----
  registry.register(
    {
      name: "aws_invoke_lambda",
      adapter: "aws",
      description: "Invoke an AWS Lambda function",
      inputSchema: {
        type: "object",
        properties: {
          function_name: {
            type: "string",
            description: "Name or ARN of the Lambda function",
          },
          payload: {
            type: "object",
            description: "JSON payload to send to the function",
          },
          invocation_type: {
            type: "string",
            enum: ["RequestResponse", "Event", "DryRun"],
            description:
              "Invocation type: RequestResponse (sync), Event (async), DryRun (validate)",
          },
        },
        required: ["function_name"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = parseAwsCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { function_name, payload, invocation_type } = input as {
        function_name: string;
        payload?: Record<string, unknown>;
        invocation_type?: string;
      };

      const encodedName = encodeURIComponent(function_name);
      const path = `/2015-03-31/functions/${encodedName}/invocations`;
      const extraHeaders: Record<string, string> = {};
      if (invocation_type) {
        extraHeaders["X-Amz-Invocation-Type"] = invocation_type;
      }

      const body = payload ? JSON.stringify(payload) : undefined;
      const result = await awsFetch(
        "lambda",
        path,
        credsOrErr,
        "POST",
        body,
        extraHeaders
      );

      if (!result.ok) {
        return {
          success: false,
          error: `AWS Lambda error: ${result.error}`,
        };
      }

      return {
        success: true,
        data: {
          function_name,
          invocation_type: invocation_type ?? "RequestResponse",
          response: result.data,
        },
      };
    }
  );
}
