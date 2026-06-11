// Creates + enables the delivery customization that links the deployed
// Shopify Function (Component B). Run AFTER `shopify app deploy` and after
// the app is installed on the store.
//
// Required env: SHOP_DOMAIN, ADMIN_API_ACCESS_TOKEN
// Run with: npm run activate-function

import { adminGraphQL, failOnUserErrors, type UserError } from "./lib/admin.js";

const CUSTOMIZATION_TITLE = "B2B-only weight shipping visibility";
const FUNCTION_API_TYPE = "delivery_customization";

const FUNCTIONS_QUERY = /* GraphQL */ `
  query ShopifyFunctions($first: Int!) {
    shopifyFunctions(first: $first) {
      nodes {
        id
        title
        apiType
        app {
          title
        }
      }
    }
  }
`;

const EXISTING_QUERY = /* GraphQL */ `
  query DeliveryCustomizations($first: Int!) {
    deliveryCustomizations(first: $first) {
      nodes {
        id
        title
        enabled
        functionId
      }
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation DeliveryCustomizationCreate($deliveryCustomization: DeliveryCustomizationInput!) {
    deliveryCustomizationCreate(deliveryCustomization: $deliveryCustomization) {
      deliveryCustomization {
        id
        title
        enabled
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface FunctionNode {
  id: string;
  title: string;
  apiType: string;
  app: { title: string } | null;
}

async function main(): Promise<void> {
  const fns = await adminGraphQL<{ shopifyFunctions: { nodes: FunctionNode[] } }>(
    FUNCTIONS_QUERY,
    { first: 50 },
  );

  const candidates = fns.shopifyFunctions.nodes.filter(
    (fn) => fn.apiType === FUNCTION_API_TYPE,
  );

  if (candidates.length === 0) {
    console.error(
      "No delivery customization function found on this shop.\n" +
        "Make sure you ran `shopify app deploy` and installed the app on the store first.",
    );
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.log("Multiple delivery customization functions found:");
    for (const fn of candidates) {
      console.log(`  - ${fn.id}  "${fn.title}" (app: ${fn.app?.title ?? "?"})`);
    }
  }
  const fn = candidates[0];
  console.log(`Using function ${fn.id} ("${fn.title}", app: ${fn.app?.title ?? "?"})`);

  const existing = await adminGraphQL<{
    deliveryCustomizations: {
      nodes: { id: string; title: string; enabled: boolean; functionId: string }[];
    };
  }>(EXISTING_QUERY, { first: 50 });

  const already = existing.deliveryCustomizations.nodes.find(
    (dc) => dc.functionId === fn.id || dc.title === CUSTOMIZATION_TITLE,
  );
  if (already) {
    console.log(
      `✅ Delivery customization already exists: ${already.id} ` +
        `("${already.title}", enabled=${already.enabled}). Nothing to do.`,
    );
    return;
  }

  const result = await adminGraphQL<{
    deliveryCustomizationCreate: {
      deliveryCustomization: { id: string; title: string; enabled: boolean } | null;
      userErrors: UserError[];
    };
  }>(CREATE_MUTATION, {
    deliveryCustomization: {
      functionId: fn.id,
      title: CUSTOMIZATION_TITLE,
      enabled: true,
    },
  });

  const errors = result.deliveryCustomizationCreate.userErrors;
  if (errors.some((e) => /function/i.test(e.message))) {
    console.error(
      "deliveryCustomizationCreate rejected the functionId. Only the app that OWNS the\n" +
        "function may create the customization — with the client credentials grant the token\n" +
        "already belongs to GN B2B Shipping, so this usually means the function isn't on the\n" +
        "store yet. Check that `shopify app deploy` succeeded (released, not --no-release)\n" +
        "and that the app is installed on the store, then re-run. If you set\n" +
        "ADMIN_API_ACCESS_TOKEN from a DIFFERENT app, unset it so the grant is used instead.",
    );
  }
  failOnUserErrors("deliveryCustomizationCreate", errors);

  console.log(
    `✅ Delivery customization created and enabled: ${result.deliveryCustomizationCreate.deliveryCustomization?.id}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
