// Audits the catalog for variants with missing or zero weight.
// Weight-based rates are only as good as the product weights!
//
// Required env: SHOP_DOMAIN, ADMIN_API_ACCESS_TOKEN (read_products scope)
// Run with: npm run check-weights
// Exits 1 if any ACTIVE product has a variant without a positive weight.

import { adminGraphQL } from "./lib/admin.js";

const QUERY = /* GraphQL */ `
  query VariantWeights($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        sku
        product {
          title
          status
        }
        inventoryItem {
          measurement {
            weight {
              value
              unit
            }
          }
        }
      }
    }
  }
`;

interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  product: { title: string; status: string };
  inventoryItem: {
    measurement: { weight: { value: number; unit: string } | null } | null;
  } | null;
}

async function main(): Promise<void> {
  const missing: VariantNode[] = [];
  let after: string | null = null;
  let scanned = 0;

  for (;;) {
    const data: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: VariantNode[];
      };
    } = await adminGraphQL(QUERY, { first: 250, after });

    for (const variant of data.productVariants.nodes) {
      scanned += 1;
      const weight = variant.inventoryItem?.measurement?.weight;
      if (!weight || weight.value <= 0) {
        missing.push(variant);
      }
    }

    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor;
  }

  console.log(`Scanned ${scanned} variants.`);

  if (missing.length === 0) {
    console.log("✅ Every variant has a positive weight. Safe for weight-based rates.");
    return;
  }

  console.log(`\n⚠️  ${missing.length} variant(s) with MISSING or ZERO weight:\n`);
  for (const variant of missing) {
    console.log(
      `  [${variant.product.status}] ${variant.product.title} — ${variant.title}` +
        (variant.sku ? ` (SKU ${variant.sku})` : "") +
        `  ${variant.id}`,
    );
  }
  console.log(
    "\nFix these in Shopify admin (product → variant → Shipping → Weight) before going live.",
  );

  const activeMissing = missing.filter((v) => v.product.status === "ACTIVE");
  if (activeMissing.length > 0) {
    console.error(`\n❌ ${activeMissing.length} of them belong to ACTIVE products.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
