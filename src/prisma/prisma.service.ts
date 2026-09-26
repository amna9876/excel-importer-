import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const CONNECT_ATTEMPTS = 6;
const CONNECT_RETRY_DELAY_MS = 4000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Neon's free tier suspends idle databases; the first connection attempt
  // after a suspend fails while the compute wakes up, so retry instead of crashing.
  async onModuleInit(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.$connect();
        return;
      } catch (err) {
        if (attempt >= CONNECT_ATTEMPTS) throw err;
        this.logger.warn(`Database not reachable (attempt ${attempt}/${CONNECT_ATTEMPTS}), retrying...`);
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
