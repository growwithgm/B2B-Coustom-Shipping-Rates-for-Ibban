// Minimal Admin GraphQL client for the one-off setup scripts.
//
// Token acquisition (current Dev Dashboard flow): the old "reveal shpat_ in
// store admin" path is gone for CLI/Dev-Dashboard apps. Instead we use the
// OAuth *client credentials grant*: exchange the app's Client ID + Secret for
// a 24-hour Admin token, programmatically, each time a script runs.
// Docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
//
// Requirements for the grant to work:
//   1. The app version (with its scopes) has been deployed: `shopify app deploy`
//   2. The app is INSTALLED on the store (Dev Dashboard -> app -> Home -> Install app)
//   3. App and store belong to the same organization in the Dev Dashboard
//
// Escape hatch: set ADMIN_API_ACCESS_TOKEN to skip the grant and use a
// ready-made token directly (e.g. from a legacy admin-created custom app).

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

let cachedToken: string | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const direct = process.env.ADMIN_API_ACCESS_TOKEN;
  if (direct) {
    cachedToken = direct;
    return direct;
  }

  const shop = requireEnv("SHOP_DOMAIN");
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "No Admin API credentials configured.\n" +
        "Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (Dev Dashboard → Apps → " +
        "GN B2B Shipping → Settings) to use the client credentials grant, or set " +
        "ADMIN_API_ACCESS_TOKEN to use an existing token directly.",
    );
    process.exit(1);
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (body.includes("shop_not_permitted")) {
      console.error(
        "Client credentials grant refused (shop_not_permitted).\n" +
          "The grant only works when the app and the store belong to the SAME organization\n" +
          "in the Dev Dashboard. Check that:\n" +
          "  - dev.shopify.com/dashboard shows the app under Apps for this organization\n" +
          "  - SHOP_DOMAIN matches the store's *.myshopify.com domain exactly\n" +
          "  - the app is installed on the store (Dev Dashboard → app → Home → Install app)",
      );
      process.exit(1);
    }
    throw new Error(`Token request failed: HTTP ${response.status}: ${body}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    scope: string;
    expires_in: number;
  };
  console.log(
    `Obtained Admin token via client credentials grant ` +
      `(scopes: ${json.scope}; expires in ${Math.round(json.expires_in / 3600)} h).`,
  );
  cachedToken = json.access_token;
  return cachedToken;
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
  const token = await getAccessToken();

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
