/**
 * POST /api/auth/signup — create a new user account.
 *
 * Body: { email, password, name? }
 *
 * Creates a User row with bcrypt-hashed password + default UserSettings.
 * Does NOT sign the user in — the client calls signIn() after signup.
 *
 * Per BR-WEB-5: this is the ONLY unauthenticated route (besides NextAuth's
 * own endpoints). It creates the user; subsequent requests require a session.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";

const BCRYPT_COST = 12;

const SignUpSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = SignUpSchema.parse(body);

    // Check if user already exists
    const existing = await db.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    // Create user + default UserSettings in one transaction
    const user = await db.user.create({
      data: {
        email: input.email,
        name: input.name || null,
        passwordHash,
        role: "USER",
        locale: "EN",
        userSettings: {
          create: {
            theme: "DARK",
            locale: "EN",
            defaultLaborMode: "CONSUMPTION",
            defaultOverheadPct: "10",
            defaultProfitPct: "15",
          },
        },
      },
      select: { id: true, email: true, name: true },
    });

    return NextResponse.json(
      { success: true, userId: user.id },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: err.issues },
        { status: 400 },
      );
    }
    console.error("[signup] Error:", err);
    return NextResponse.json(
      { error: "Sign-up failed" },
      { status: 500 },
    );
  }
}
