import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

interface CliArgs {
  email?: string;
  role: 'admin' | 'user';
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { role: 'admin' };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--email' || token === '-e') {
      const value = argv[i + 1];
      if (value) {
        args.email = value;
        i += 1;
      }
      continue;
    }
    if (token === '--role' || token === '-r') {
      const value = argv[i + 1];
      if (value === 'admin' || value === 'user') {
        args.role = value;
        i += 1;
      }
      continue;
    }
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return args;
}

function printUsage(): void {
  console.log('Usage: npm run make-admin -- --email user@example.com [--role admin|user]');
}

async function main(): Promise<void> {
  const { email, role } = parseArgs(process.argv.slice(2));
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    printUsage();
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, role: true },
  });

  if (!user) {
    console.error(`User not found: ${normalizedEmail}`);
    process.exit(1);
  }

  if (user.role === role) {
    console.log(`No change needed: ${user.email} already has role "${role}"`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role },
    select: { id: true, email: true, role: true },
  });

  console.log(`Updated user role: ${updated.email} -> ${updated.role}`);
}

void main()
  .catch(error => {
    console.error('make-admin failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
