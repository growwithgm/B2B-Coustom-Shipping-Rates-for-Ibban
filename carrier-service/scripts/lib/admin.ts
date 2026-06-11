// Minimal Admin GraphQL client for the one-off setup scripts.
// Uses native fetch (Node 20+) — no heavy SDK needed for two mutations.

import "dotenv/config";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-01";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing required env var ${name}. Copy carrier-service/.env.example to ` +
        `carrier-service/.env and fill it in (or export the variable).`,
    );
    process.exit(1);
  }
  return value;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: unknown;
}

export async function adminGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const shop = requireEnv("SHOP_DOMAIN");
  const token = requireEnv("ADMIN_API_ACCESS_TOKEN");

  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Admin API HTTP ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as GraphQLResponse<T>;
  if (json.errors) {
    throw new Error(`Admin API GraphQL errors:\n${JSON.stringify(json.errors, null, 2)}`);
  }
  if (!json.data) {
    throw new Error("Admin API returned no data.");
  }
  return json.data;
}

export interface UserError {
  field?: string[] | null;
  message: string;
}

export function failOnUserErrors(label: string, userErrors: UserError[]): void {
  if (userErrors.length > 0) {
    console.error(`${label} returned userErrors:`);
    for (const err of userErrors) {
      console.error(`  - ${err.field?.join(".") ?? "(general)"}: ${err.message}`);
    }
    process.exit(1);
  }
}
