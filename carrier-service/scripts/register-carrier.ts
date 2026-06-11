// Registers (or updates) the carrier service pointing at the Render app.
// Idempotent: re-running updates the callback URL of the existing service.
//
// Required env: SHOP_DOMAIN, ADMIN_API_ACCESS_TOKEN, APP_URL, CALLBACK_SECRET
// Run with: npm run register-carrier

import { SHIPPING_CONFIG } from "../src/config.js";
import { adminGraphQL, failOnUserErrors, requireEnv, type UserError } from "./lib/admin.js";

interface CarrierServiceNode {
  id: string;
  name: string;
  callbackUrl: string | null;
  active: boolean;
}

const LIST_QUERY = /* GraphQL */ `
  query CarrierServices($first: Int!) {
    carrierServices(first: $first) {
      nodes {
        id
        name
        callbackUrl
        active
      }
    }
  }
`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation CarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService {
        id
        name
        callbackUrl
        active
        supportsServiceDiscovery
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_MUTATION = /* GraphQL */ `
  mutation CarrierServiceUpdate($input: DeliveryCarrierServiceUpdateInput!) {
    carrierServiceUpdate(input: $input) {
      carrierService {
        id
        name
        callbackUrl
        active
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function main(): Promise<void> {
  const appUrl = requireEnv("APP_URL").replace(/\/+$/, "");
  const secret = requireEnv("CALLBACK_SECRET");
  const callbackUrl = `${appUrl}/carrier-service/rates/${secret}`;

  console.log(`Carrier name:  ${SHIPPING_CONFIG.carrierName}`);
  console.log(`Callback URL:  ${appUrl}/carrier-service/rates/<secret>`);

  const listed = await adminGraphQL<{
    carrierServices: { nodes: CarrierServiceNode[] };
  }>(LIST_QUERY, { first: 100 });

  const existing = listed.carrierServices.nodes.find(
    (cs) => cs.name === SHIPPING_CONFIG.carrierName,
  );

  if (existing) {
    console.log(`Found existing carrier service ${existing.id} — updating callback URL.`);
    const result = await adminGraphQL<{
      carrierServiceUpdate: {
        carrierService: CarrierServiceNode | null;
        userErrors: UserError[];
      };
    }>(UPDATE_MUTATION, {
      input: { id: existing.id, callbackUrl, active: true },
    });
    failOnUserErrors("carrierServiceUpdate", result.carrierServiceUpdate.userErrors);
    console.log("✅ Carrier service updated:", result.carrierServiceUpdate.carrierService?.id);
  } else {
    const result = await adminGraphQL<{
      carrierServiceCreate: {
        carrierService: (CarrierServiceNode & { supportsServiceDiscovery: boolean }) | null;
        userErrors: UserError[];
      };
    }>(CREATE_MUTATION, {
      input: {
        name: SHIPPING_CONFIG.carrierName,
        callbackUrl,
        active: true,
        supportsServiceDiscovery: true,
      },
    });
    failOnUserErrors("carrierServiceCreate", result.carrierServiceCreate.userErrors);
    console.log("✅ Carrier service created:", result.carrierServiceCreate.carrierService?.id);
  }

  console.log(
    "\nNext: in Shopify admin go to Settings → Shipping and delivery → (your General profile)\n" +
      `and add the carrier "${SHIPPING_CONFIG.carrierName}" as a rate provider for the zones\n` +
      "it should serve (e.g. a worldwide zone), so its rate is offered at checkout.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
