import { budgetMcpEndpoint } from './mcp/connections';
import { callBudgetMcp } from './budgetMcp';
// REST bridge to the sibling `daily-budget` app.
//
// Phase 4 upgrade: instead of a one-way deep link, talk to daily-budget's
// `budget-api` Edge Function over HTTPS. This lets the assistant ANSWER budget
// questions ("เหลือใช้ได้กี่บาท", "วันนี้ใช้เกินงบยัง") out loud, and log / edit /
// delete expenses — all without leaving voice-reminder or sharing a login.
//
// Kept behind this small gateway so the transport can change without touching
// callers. When the API is not configured, expense recording falls back to the
// deep link (see integrations/dailyBudget.ts); budget questions need the API.

import { config, isBudgetApiConfigured } from '../config';
import { getAccessToken, isConnected } from './budgetOAuth';

/** Which kind of budget answer the user asked for (shapes the spoken reply). */
export type BudgetKind = 'today' | 'remaining' | 'status' | 'summary';

/** The compact month summary returned by the Edge Function. */
export interface BudgetSummary {
  month: string;
  budget: number;
  spent: number;
  income: number;
  outOfBudgetSpent: number;
  remaining: number;
  percentUsed: number;
  daysInMonth: number;
  dayOfMonth: number;
  daysElapsed: number;
  daysLeftInclToday: number;
  availablePerRemainingDay: number;
  baselineDailyBudget: number;
  actualDailyAvg: number;
  projectedTotal: number;
  projectedOverUnder: number;
  todaySpent: number;
  status: 'under' | 'on_track' | 'over' | 'no_budget';
}

export interface BudgetTransaction {
  id: string;
  amount: number;
  type: 'expense' | 'income';
  note: string | null;
  date: string;
  excludeFromBudget: boolean;
  createdAt: string;
}

export interface AddExpenseInput {
  amount: number;
  note?: string;
  date?: string;
  type?: 'expense' | 'income';
  categoryKey?: string;
  excludeFromBudget?: boolean;
}

export interface UpdateExpenseInput {
  id: string;
  amount?: number;
  note?: string;
  date?: string;
  categoryKey?: string;
  excludeFromBudget?: boolean;
}

/** The bearer token for budget-api: a per-user OAuth access token if the user
 *  has connected their account, otherwise the legacy shared token (if set). */
async function resolveAuthToken(): Promise<string | null> {
  const oauth = await getAccessToken();
  if (oauth) return oauth;
  return config.budgetApi.token || null;
}

/** True when budget-api can be called — user connected via OAuth, or a legacy
 *  shared token is configured. */
export async function isBudgetReady(): Promise<boolean> {
  if (!isBudgetApiConfigured()) return false;
  if (!(await budgetMcpEndpoint()) && config.budgetApi.token) return true;
  return isConnected();
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  if (!isBudgetApiConfigured()) throw new Error('budget_api_not_configured');
  const mcpEndpoint = await budgetMcpEndpoint();
  if (mcpEndpoint) {
    const oauth = await getAccessToken();
    if (!oauth) throw new Error('Connect your Daily Budget account to use MCP.');
    return callBudgetMcp<T>(mcpEndpoint, oauth, payload);
  }
  const token = await resolveAuthToken();
  if (!token) throw new Error('not_connected');
  const res = await fetch(config.budgetApi.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.error)) {
    throw new Error(`budget_api_error ${res.status} ${data?.error ?? ''} ${data?.detail ?? ''}`.trim());
  }
  return data as T;
}

export async function fetchBudgetSummary(month?: string): Promise<BudgetSummary> {
  const data = await call<{ summary: BudgetSummary }>({ action: 'summary', month });
  return data.summary;
}

/** Recent transactions (most recent first). Used to resolve edits/deletes. */
export async function listExpenses(opts: { date?: string; limit?: number } = {}): Promise<BudgetTransaction[]> {
  const data = await call<{ transactions: BudgetTransaction[] }>({
    action: 'list',
    date: opts.date,
    limit: opts.limit ?? 10,
  });
  return data.transactions;
}

export async function addExpense(input: AddExpenseInput): Promise<BudgetTransaction> {
  const data = await call<{ transaction: BudgetTransaction }>({ action: 'add_expense', ...input });
  return data.transaction;
}

export async function updateExpense(input: UpdateExpenseInput): Promise<BudgetTransaction> {
  const data = await call<{ transaction: BudgetTransaction }>({ action: 'update_expense', ...input });
  return data.transaction;
}

export async function deleteExpense(id: string): Promise<BudgetTransaction> {
  const data = await call<{ deleted: BudgetTransaction }>({ action: 'delete_expense', id });
  return data.deleted;
}

// ── spoken answers ───────────────────────────────────────────────────────────
/** Round to whole baht and group thousands for natural speech ("3,200 baht"). */
function baht(n: number): string {
  const rounded = Math.round(Math.abs(n));
  return `${rounded.toLocaleString('en-US')} baht`;
}

/**
 * Compose a short spoken answer from a summary, shaped by what was asked.
 * English to match the rest of the app's spoken replies (see brain/prompt.ts).
 */
export function formatBudgetAnswer(s: BudgetSummary, kind: BudgetKind, language: 'th' | 'en' = 'en'): string {
  if (language === 'th') {
    const amount = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('th-TH')} บาท`;
    if (s.budget <= 0) return `ยังไม่ได้ตั้งงบรายเดือน เดือนนี้ใช้ไป ${amount(s.spent)} วันนี้ใช้ไป ${amount(s.todaySpent)}`;
    const remaining = s.remaining < 0 ? `เกินงบแล้ว ${amount(s.remaining)}` : `เหลืองบ ${amount(s.remaining)} เฉลี่ยใช้ได้วันละ ${amount(s.availablePerRemainingDay)}`;
    if (kind === 'today') return `วันนี้ใช้ไป ${amount(s.todaySpent)} เป้าต่อวัน ${amount(s.baselineDailyBudget)} ${remaining}`;
    if (kind === 'remaining') return `${remaining} เหลืออีก ${s.daysLeftInclToday} วันในเดือนนี้`;
    if (kind === 'status') return `เดือนนี้ใช้ไป ${amount(s.spent)} จากงบ ${amount(s.budget)} ${remaining}`;
    return `เดือนนี้ใช้ไป ${amount(s.spent)} จากงบ ${amount(s.budget)} วันนี้ ${amount(s.todaySpent)} ${remaining} หากใช้ในอัตรานี้คาดว่าจะ${s.projectedOverUnder > 0 ? 'เกินงบ' : 'เหลืองบ'} ${amount(s.projectedOverUnder)}`;
  }
  if (s.budget <= 0) {
    return `No monthly budget is set. So far this month you have spent ${baht(s.spent)}${
      s.todaySpent > 0 ? `, ${baht(s.todaySpent)} of it today` : ''
    }.`;
  }

  const overBudget = s.remaining < 0;
  const perDay = s.availablePerRemainingDay;

  switch (kind) {
    case 'today': {
      // "did I overspend today?" — compare today's spend to the daily allowance.
      const allowance = s.baselineDailyBudget;
      const todayLine = `Today you have spent ${baht(s.todaySpent)}`;
      if (overBudget) {
        return `${todayLine}. You are already over the monthly budget by ${baht(s.remaining)}.`;
      }
      if (s.todaySpent > allowance) {
        return `${todayLine}, which is over the daily target of ${baht(allowance)}. You can still spend ${baht(perDay)} per day for the rest of the month.`;
      }
      return `${todayLine}, within the daily target of ${baht(allowance)}. You have ${baht(perDay)} left to spend today.`;
    }

    case 'remaining': {
      if (overBudget) {
        return `You are over budget by ${baht(s.remaining)} this month. Time to slow down.`;
      }
      return `You have ${baht(s.remaining)} left this month — about ${baht(perDay)} per day for the remaining ${s.daysLeftInclToday} ${s.daysLeftInclToday === 1 ? 'day' : 'days'}.`;
    }

    case 'status': {
      if (overBudget) {
        return `You are over budget by ${baht(s.remaining)}. Spent ${baht(s.spent)} of ${baht(s.budget)}.`;
      }
      const paceLabel =
        s.status === 'over' ? 'spending faster than planned'
        : s.status === 'under' ? 'under your pace, doing well'
        : 'right on track';
      return `You have spent ${baht(s.spent)} of ${baht(s.budget)}, ${baht(s.remaining)} left. You are ${paceLabel}.`;
    }

    case 'summary':
    default: {
      const proj = s.projectedOverUnder > 0
        ? `At this pace you are projected to go over by ${baht(s.projectedOverUnder)}.`
        : `At this pace you should finish ${baht(s.projectedOverUnder)} under budget.`;
      const left = overBudget
        ? `You are over budget by ${baht(s.remaining)}.`
        : `You have ${baht(s.remaining)} left, about ${baht(perDay)} per day.`;
      return `Spent ${baht(s.spent)} of ${baht(s.budget)} this month, ${baht(s.todaySpent)} today. ${left} ${proj}`;
    }
  }
}
