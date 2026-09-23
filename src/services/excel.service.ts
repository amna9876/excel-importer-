import ExcelJS from 'exceljs';
import { FailedRow, ParsedRawRow, ValidProductRow } from '../types';

const REQUIRED_HEADERS = ['sku', 'name', 'price', 'inventory', 'description', 'category'];

// Excel cells can hold plain strings/numbers, Date objects, rich text
// ({ richText: [...] }), or formula results ({ formula, result }). This
// normalizes any of those into a plain trimmed string.
function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const obj = value as unknown as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text: string }>).map((rt) => rt.text).join('');
    }
    if ('result' in obj) return String(obj.result ?? '');
  }

  return String(value).trim();
}

export async function parseProductsWorkbook(buffer: Buffer): Promise<ParsedRawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Workbook has no worksheets');
  }

  const headerMap: Record<string, number> = {};
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const header = cellToText(cell.value).toLowerCase();
    if (header) headerMap[header] = colNumber;
  });

  const missingHeaders = REQUIRED_HEADERS.filter((h) => !(h in headerMap));
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required column(s): ${missingHeaders.join(', ')}`);
  }

  const getCell = (row: ExcelJS.Row, header: string): string => {
    const colNumber = headerMap[header];
    return colNumber ? cellToText(row.getCell(colNumber).value) : '';
  };

  const rows: ParsedRawRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const raw: ParsedRawRow = {
      rowNumber,
      sku: getCell(row, 'sku'),
      name: getCell(row, 'name'),
      price: getCell(row, 'price'),
      inventory: getCell(row, 'inventory'),
      description: getCell(row, 'description'),
      category: getCell(row, 'category'),
      colors: getCell(row, 'colors'),
    };

    const isEmptyRow = Object.entries(raw)
      .filter(([key]) => key !== 'rowNumber')
      .every(([, value]) => value === '');

    if (!isEmptyRow) rows.push(raw);
  });

  return rows;
}

type ValidationResult =
  | { valid: true; data: ValidProductRow }
  | { valid: false; reason: string };

export function validateRow(raw: ParsedRawRow): ValidationResult {
  if (!raw.sku) return { valid: false, reason: 'missing sku' };
  if (!raw.name) return { valid: false, reason: 'missing name' };

  if (!raw.price) return { valid: false, reason: 'missing price' };
  const price = Number(raw.price);
  if (Number.isNaN(price)) return { valid: false, reason: 'invalid price (must be a number)' };
  if (price <= 0) return { valid: false, reason: 'price must be greater than 0' };

  if (!raw.inventory) return { valid: false, reason: 'missing inventory' };
  const inventory = Number(raw.inventory);
  if (Number.isNaN(inventory)) {
    return { valid: false, reason: 'invalid inventory (must be a number)' };
  }
  if (inventory <= 0) return { valid: false, reason: 'inventory must be greater than 0' };

  if (!raw.description) return { valid: false, reason: 'missing description' };
  if (!raw.category) return { valid: false, reason: 'missing category' };

  const colors = raw.colors
    ? raw.colors.split(',').map((c) => c.trim()).filter(Boolean)
    : [];

  return {
    valid: true,
    data: {
      sku: raw.sku,
      name: raw.name,
      price,
      inventory,
      description: raw.description,
      category: raw.category,
      colors,
    },
  };
}

export async function generateFailedRowsWorkbook(failedRows: FailedRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Failed Rows');

  sheet.columns = [
    { header: 'Row', key: 'rowNumber', width: 8 },
    { header: 'sku', key: 'sku', width: 20 },
    { header: 'name', key: 'name', width: 25 },
    { header: 'price', key: 'price', width: 12 },
    { header: 'inventory', key: 'inventory', width: 12 },
    { header: 'description', key: 'description', width: 30 },
    { header: 'category', key: 'category', width: 18 },
    { header: 'colors', key: 'colors', width: 18 },
    { header: 'reason', key: 'reason', width: 32 },
  ];

  for (const failed of failedRows) {
    sheet.addRow({
      rowNumber: failed.rowNumber,
      sku: failed.raw.sku,
      name: failed.raw.name,
      price: failed.raw.price,
      inventory: failed.raw.inventory,
      description: failed.raw.description,
      category: failed.raw.category,
      colors: failed.raw.colors,
      reason: failed.reason,
    });
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as Buffer;
}
