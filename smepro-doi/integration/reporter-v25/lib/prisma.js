// lib/prisma.js — Prisma client singleton (avoids exhausting connections on hot reload).
// If Reporter V2.5 already exports a Prisma client, delete this and import that one instead.
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
