import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsPositive, IsString, Min } from 'class-validator';

// One row = one product. Validated with class-validator so every failure
// reason comes from a declarative constraint instead of hand-written ifs.
export class ProductRowDto {
  @IsString()
  @IsNotEmpty({ message: 'sku is required' })
  sku!: string;

  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'description is required' })
  description!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'price must be a number' })
  @IsPositive({ message: 'price must be greater than 0' })
  price!: number;

  @IsString()
  @IsNotEmpty({ message: 'category is required' })
  category!: string;

  @IsString()
  @IsNotEmpty({ message: 'color is required' })
  color!: string;

  @Type(() => Number)
  @IsInt({ message: 'stock must be a whole number' })
  @Min(0, { message: 'stock must be 0 or greater' })
  stock!: number;
}
