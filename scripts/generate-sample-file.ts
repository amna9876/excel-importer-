import ExcelJS from 'exceljs';
import path from 'path';

async function main(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');

  sheet.columns = [
    { header: 'sku', key: 'sku', width: 15 },
    { header: 'name', key: 'name', width: 25 },
    { header: 'description', key: 'description', width: 30 },
    { header: 'price', key: 'price', width: 10 },
    { header: 'category', key: 'category', width: 15 },
    { header: 'color', key: 'color', width: 12 },
    { header: 'stock', key: 'stock', width: 10 },
  ];

  sheet.addRows([
    {
      sku: 'SKU-001',
      name: 'Classic T-Shirt',
      description: 'A comfortable cotton t-shirt',
      price: 19.99,
      category: 'Apparel',
      color: 'Blue',
      stock: 100,
    },
    {
      sku: 'SKU-002',
      name: 'Running Shoes',
      description: 'Lightweight running shoes',
      price: 59.99,
      category: 'Footwear',
      color: 'White',
      stock: 50,
    },
    {
      // Missing price -> should land in failed-rows.xlsx
      sku: 'SKU-003',
      name: 'Missing Price Item',
      description: 'This row is missing a price',
      price: '',
      category: 'Apparel',
      color: 'Black',
      stock: 20,
    },
    {
      // Reuses SKU-001 -> should be flagged as a duplicate
      sku: 'SKU-001',
      name: 'Duplicate SKU Item',
      description: 'This SKU duplicates row 1',
      price: 9.99,
      category: 'Apparel',
      color: 'Red',
      stock: 10,
    },
    {
      // Non-numeric stock -> should fail validation
      sku: 'SKU-004',
      name: 'Bad Stock Item',
      description: 'Stock is not a number',
      price: 15,
      category: 'Apparel',
      color: 'Green',
      stock: 'abc',
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
