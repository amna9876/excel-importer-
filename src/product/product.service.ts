import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  // Every read path filters deletedAt: null — soft-deleted rows stay in the
  // table (for audit history and referential safety) but are never listed.
  findAll() {
    return this.prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async softDelete(id: string) {
    await this.findOne(id); // 404s if missing or already deleted
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.deletedAt === null) {
      throw new NotFoundException('Deleted product not found');
    }
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: null },
    });
  }
}
