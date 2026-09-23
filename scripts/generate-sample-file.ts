import ExcelJS from 'exceljs';
import path from 'path';

async function main(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');

  sheet.columns = [
    { header: 'sku', key: 'sku', width: 15 },
    { header: 'name', key: 'name', width: 25 },
    { header: 'price', key: 'price', width: 10 },
    { header: 'inventory', key: 'inventory', width: 12 },
    { header: 'description', key: 'description', width: 30 },
    { header: 'category', key: 'category', width: 15 },
    { header: 'colors', key: 'colors', width: 20 },
  ];

  sheet.addRows([
    {
      sku: 'SKU-001',
      name: 'Classic T-Shirt',
      price: 19.99,
      inventory: 100,
      description: 'A comfortable cotton t-shirt',
      category: 'Apparel',
      colors: 'Red, Blue, Black',
    },
    {
      sku: 'SKU-002',
      name: 'Running Shoes',
      price: 59.99,
      inventory: 50,
      description: 'Lightweight running shoes',
      category: 'Footwear',
      colors: 'White',
    },
    {
      // Row intentionally missing a price -> should land in failed-rows.xlsx
      sku: 'SKU-003',
      name: 'Missing Price Item',
      price: '',
      inventory: 20,
      description: 'This row is missing a price',
      category: 'Apparel',
      colors: '',
    },
    {
      // Row intentionally reuses SKU-001 -> should be flagged as duplicate
      sku: 'SKU-001',
      name: 'Duplicate SKU Item',
      price: 9.99,
      inventory: 10,
      description: 'This SKU duplicates row 1',
      category: 'Apparel',
      colors: '',
    },
    {
      // Row intentionally has non-numeric inventory -> should fail validation
      sku: 'SKU-004',
      name: 'Bad Inventory Item',
      price: 15,
      inventory: 'abc',
      description: 'Inventory is not a number',
      category: 'Apparel',
      colors: '',
    },
  ]);

  const outPath = path.join(__dirname, '..', 'sample-products.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log(`Sample file written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
