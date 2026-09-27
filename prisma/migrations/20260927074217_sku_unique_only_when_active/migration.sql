-- The old unconditional unique constraint blocked reusing a soft-deleted
-- product's SKU, since it applied to every row regardless of deletedAt.
DROP INDEX IF EXISTS "Product_sku_key";

-- Uniqueness now only applies among active (non-deleted) products, so a
-- deleted product's SKU is free to be imported again.
CREATE UNIQUE INDEX "Product_sku_active_key" ON "Product" ("sku") WHERE "deletedAt" IS NULL;

-- Plain index for SKU lookups that don't filter on deletedAt.
CREATE INDEX "Product_sku_idx" ON "Product" ("sku");
