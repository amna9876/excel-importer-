import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  findAll() {
    return this.productService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productService.softDelete(id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.productService.restore(id);
  }
}
