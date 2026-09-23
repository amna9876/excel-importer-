import { Schema, model, Document } from 'mongoose';

export interface IProduct extends Document {
  sku: string;
  name: string;
  price: number;
  inventory: number;
  description: string;
  category: string;
  colors: string[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    inventory: { type: Number, required: true, min: 0 },
    description: { type: String, required: true },
    category: { type: String, required: true, trim: true },
    colors: { type: [String], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Product = model<IProduct>('Product', productSchema);
