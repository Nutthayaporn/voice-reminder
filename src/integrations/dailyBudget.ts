// Integration with the sibling app `daily-budget` (../daily-budget).
//
// Phase 4: when the brain detects an expense ("ซื้อโจ๊ก 60 บาท"), hand it off to
// daily-budget via a deep link into its existing add-transaction screen, which
// already reads `amount` / `note` / `date` search params (see daily-budget
// app/entry.tsx). This is decoupled and works local-first — no shared auth or
// Supabase needed. The user confirms the save in daily-budget.
//
// Kept behind a small gateway function so a future transport (a direct Supabase
// insert, or a daily-budget Edge Function that saves without confirmation) can
// replace the deep link without touching callers.

import { Linking } from 'react-native';

const SCHEME = 'dailybudget'; // daily-budget app.json → expo.scheme

export interface ExpensePayload {
  amount: number;
  /** short label, becomes the transaction note */
  note?: string;
  /** 'YYYY-MM-DD' local date; defaults to today in daily-budget if omitted */
  date?: string;
}

export interface ExpenseHandoffResult {
  ok: boolean;
  /** false specifically when daily-budget isn't installed / can't be opened */
  appAvailable: boolean;
}

export async function sendExpenseToDailyBudget(
  p: ExpensePayload,
): Promise<ExpenseHandoffResult> {
  const qs = new URLSearchParams();
  qs.set('amount', String(p.amount));
  qs.set('type', 'expense');
  if (p.note) qs.set('note', p.note);
  if (p.date) qs.set('date', p.date);
  const url = `${SCHEME}://entry?${qs.toString()}`;

  try {
    // canOpenURL needs `dailybudget` in iOS LSApplicationQueriesSchemes
    // (declared in app.json); if it can't confirm, we still try openURL.
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    await Linking.openURL(url);
    return { ok: true, appAvailable: canOpen };
  } catch {
    return { ok: false, appAvailable: false };
  }
}
