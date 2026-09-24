import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductRowDto } from './dto/product-row.dto';
import { FailedRow, RawProductRow } from './processing.types';

const REQUIRED_HEADERS = ['sku', 'name', 'description', 'price', 'category', 'color', 'stock'];

// Real-world sheets name these two columns inconsistently (the plan itself
// said "inventory/stock" and "colors") — accept the common variants.
const HEADER_ALIASES: Record<string, string[]> = {
  color: ['color', 'colors'],
  stock: ['stock', 'inventory'],
};

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

type RowValidationResult =
  | { valid: true; data: ProductRowDto }
  | { valid: false; reason: string };

@Injectable()
export class ExcelService {
  async parseRows(buffer: Buffer): Promise<RawProductRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('Workbook has no worksheets');
    }

    const headerMap: Record<string, number> = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const header = cellToText(cell.value).toLowerCase();
      if (!header) return;
      const canonical =
        Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(header))?.[0] ?? header;
      headerMap[canonical] = colNumber;
    });

    const missingHeaders = REQUIRED_HEADERS.filter((h) => !(h in headerMap));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing required column(s): ${missingHeaders.join(', ')}`);
    }

    const getCell = (row: ExcelJS.Row, header: string): string => {
      const colNumber = headerMap[header];
      return colNumber ? cellToText(row.getCell(colNumber).value) : '';
    };

    const rows: RawProductRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header row

      const raw: RawProductRow = {
        rowNumber,
        sku: getCell(row, 'sku'),
        name: getCell(row, 'name'),
        description: getCell(row, 'description'),
        price: getCell(row, 'price'),
        category: getCell(row, 'category'),
        color: getCell(row, 'color'),
        stock: getCell(row, 'stock'),
      };

      const isEmptyRow = Object.entries(raw)
        .filter(([key]) => key !== 'rowNumber')
        .every(([, value]) => value === '');

      if (!isEmptyRow) rows.push(raw);
    });

    return rows;
  }

  async validateRow(raw: RawProductRow): Promise<RowValidationResult> {
    const instance = plainToInstance(ProductRowDto, {
      sku: raw.sku,
      name: raw.name,
      description: raw.description,
      // '' -> undefined so Number('') (which is 0, not NaN) never silently
      // passes validation for a blank required numeric cell.
      price: raw.price === '' ? undefined : raw.price,
      category: raw.category,
      color: raw.color,
      stock: raw.stock === '' ? undefined : raw.stock,
    });

    const errors = await validate(instance);
    if (errors.length > 0) {
      const reason = errors
        .map((error) => Object.values(error.constraints ?? {}).join(', '))
        .join('; ');
      return { valid: false, reason };
    }

    return { valid: true, data: instance };
  }

  async generateErrorWorkbook(failedRows: FailedRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Failed Rows');

    sheet.columns = [
      { header: 'Row', key: 'rowNumber', width: 8 },
      { header: 'sku', key: 'sku', width: 20 },
      { header: 'name', key: 'name', width: 25 },
      { header: 'description', key: 'description', width: 30 },
      { header: 'price', key: 'price', width: 12 },
      { header: 'category', key: 'category', width: 18 },
      { header: 'color', key: 'color', width: 14 },
      { header: 'stock', key: 'stock', width: 10 },
      { header: 'errors', key: 'errors', width: 40 },
    ];

    for (const failed of failedRows) {
      sheet.addRow({
        rowNumber: failed.rowNumber,
        sku: failed.raw.sku,
        name: failed.raw.name,
        description: failed.raw.description,
        price: failed.raw.price,
        category: failed.raw.category,
        color: failed.raw.color,
        stock: failed.raw.stock,
        errors: failed.reason,
      });
    }

    sheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }
}
