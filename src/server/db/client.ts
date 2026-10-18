import { PrismaClient } from "@prisma/client";
import { withSlowQueryLog } from "./slow-query";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Phase 43: SLOW_QUERY_MS (unset = off) logs slow queries; see slow-query.ts for why the type stays PrismaClient.
export const prisma = globalForPrisma.prisma ?? withSlowQueryLog(new PrismaClient());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
