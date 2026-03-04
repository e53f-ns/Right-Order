CREATE TABLE "LoginVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoginVerification_email_key" ON "LoginVerification"("email");
CREATE INDEX "LoginVerification_userId_idx" ON "LoginVerification"("userId");
CREATE INDEX "LoginVerification_email_idx" ON "LoginVerification"("email");
CREATE INDEX "LoginVerification_expiresAt_idx" ON "LoginVerification"("expiresAt");
