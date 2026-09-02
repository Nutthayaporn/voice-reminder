// Local-first Zustand store with an optional Supabase sync layer.
//
// Local mutations are always immediate. While signed in, durable pending ops
// are queued and retried on foreground/reconnect. Cloud rows are merged by the
// Item.updated_at timestamp; notification IDs remain local to each device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { signInWithSocialProvider, type SocialAuthProvider } from '../lib/auth';
import { ensureNotifyPermission } from '../notify/setup';
import { cancelNotifications, scheduleForItem } from '../notify/scheduler';
import * as cloud from './cloud';
import type { CloudItemRow } from './cloud';
import type { Item } from './types';

export type SyncMode = 'local' | 'cloud';

export type PendingSyncOp =
  | {
      opId: string;
      userId: string;
      attempts: number;
      kind: 'upsert';
      item: Item;
      updatedAt: string;
    }
  | {
      opId: string;
      userId: string;
      attempts: number;
      kind: 'delete';
      itemId: string;
      updatedAt: string;
    };

type DistributiveOmit<T, Keys extends keyof any> = T extends any ? Omit<T, Keys> : never;
type PendingSyncInput = DistributiveOmit<PendingSyncOp, 'opId' | 'attempts'>;

interface StoreState {
  items: Item[];
  hasHydrated: boolean;

  syncMode: SyncMode;
  userId: string | null;
  userEmail: string | null;
  syncing: boolean;
  syncError: string | null;
  lastSyncedAt: string | null;
  /** Account that owns the visible local cloud cache; null before first sign-in. */
  cacheOwnerId: string | null;
  pendingOps: PendingSyncOp[];

  addItem: (item: Item) => void;
  removeItem: (id: string) => void;
  toggleDone: (id: string) => void;
  updateItem: (id: string, patch: Partial<Item>) => void;

  bootstrapSync: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error?: string; needsEmailConfirmation?: boolean }>;
  signInWithProvider: (
    provider: SocialAuthProvider,
  ) => Promise<{ error?: string; cancelled?: boolean }>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  flushPending: () => Promise<void>;
  clearSyncError: () => void;
}

let authSubscription: { unsubscribe: () => void } | null = null;
let realtimeUnsubscribe: (() => void) | null = null;
let bootstrapStarted = false;
let appStateBound = false;
let flushRun: Promise<void> | null = null;
let syncRun: Promise<void> | null = null;
let syncAgain = false;

function makeOpId(): string {
  return `sync_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseItem(item: Item): Item {
  const snooze = item.snooze_minutes;
  const remindUntilDone = item.remind_until_done ?? false;
  return {
    ...item,
    household_id: item.household_id ?? null,
    alert_mode: remindUntilDone ? 'alarm' : (item.alert_mode ?? 'notification'),
    remind_until_done: remindUntilDone,
    snooze_minutes: snooze === 5 || snooze === 10 || snooze === 30 ? snooze : 10,
    max_attempts:
      typeof item.max_attempts === 'number'
        ? Math.max(1, Math.min(20, Math.round(item.max_attempts)))
        : 5,
    updated_at: item.updated_at || item.created_at || new Date().toISOString(),
    notificationIds: item.notificationIds ?? [],
  };
}

function itemIdForOp(op: PendingSyncOp): string {
  return op.kind === 'upsert' ? op.item.id : op.itemId;
}

function newerThan(left: string, right: string): boolean {
  return Date.parse(left) > Date.parse(right);
}

function atLeastAsNew(left: string, right: string): boolean {
  return Date.parse(left) >= Date.parse(right);
}

function hasDatabaseCode(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'code' in error);
}

function scheduleFingerprint(item: Item): string {
  return JSON.stringify({
    type: item.type,
    title: item.title,
    start_at: item.start_at,
    all_day: item.all_day,
    recurrence: item.recurrence,
    alert_mode: item.alert_mode,
    remind_until_done: item.remind_until_done,
    snooze_minutes: item.snooze_minutes,
    max_attempts: item.max_attempts,
  });
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const isCloud = () =>
        get().syncMode === 'cloud' && !!get().userId && !!supabase;

      const pendingFor = (itemId: string, userId: string) =>
        get().pendingOps.find(
          (op) => op.userId === userId && itemIdForOp(op) === itemId,
        );

      const queue = (op: PendingSyncInput) => {
        const itemId = op.kind === 'upsert' ? op.item.id : op.itemId;
        set((state) => ({
          pendingOps: [
            ...state.pendingOps.filter(
              (candidate) =>
                candidate.userId !== op.userId || itemIdForOp(candidate) !== itemId,
            ),
            { ...op, opId: makeOpId(), attempts: 0 } as PendingSyncOp,
          ],
        }));
        void get().flushPending();
      };

      const queueUpsert = (item: Item) => {
        const userId = get().userId;
        if (!isCloud() || !userId) return;
        const normalised = normaliseItem(item);
        queue({
          kind: 'upsert',
          userId,
          item: normalised,
          updatedAt: normalised.updated_at,
        });
      };

      const queueDelete = (itemId: string, updatedAt: string) => {
        const userId = get().userId;
        if (!isCloud() || !userId) return;
        queue({ kind: 'delete', userId, itemId, updatedAt });
      };

      const leaveCloud = () => {
        realtimeUnsubscribe?.();
        realtimeUnsubscribe = null;
        set({
          syncMode: 'local',
          userId: null,
          userEmail: null,
          syncing: false,
        });
      };

      const enterCloud = async (userId: string, email: string | null) => {
        const changedUser = get().userId !== userId;
        const previousOwner = get().cacheOwnerId;
        if (previousOwner && previousOwner !== userId) {
          await Promise.all(
            get().items.map((item) => cancelNotifications(item.notificationIds)),
          );
          // Never copy one account's cached records into another account. Any
          // unsent operations remain owner-keyed in pendingOps for a later sign-in.
          set({ items: [], lastSyncedAt: null });
        }
        set({
          syncMode: 'cloud',
          userId,
          userEmail: email,
          cacheOwnerId: userId,
          syncError: null,
        });

        if (changedUser || !realtimeUnsubscribe) {
          realtimeUnsubscribe?.();
          realtimeUnsubscribe = cloud.subscribeCloudItems(userId, () => {
            syncAgain = true;
            void get().syncNow();
          });
        }
        await get().syncNow();
      };

      const mergeCloudRows = async (rows: CloudItemRow[], userId: string) => {
        let permissionRequested = false;
        const ensureSchedulingReady = async () => {
          if (permissionRequested) return;
          permissionRequested = true;
          await ensureNotifyPermission();
        };

        for (const row of rows) {
          if (get().userId !== userId) return;
          const pending = pendingFor(row.id, userId);
          if (pending && newerThan(pending.updatedAt, row.updated_at)) continue;

          const local = get().items.find((item) => item.id === row.id);
          if (row.deleted_at) {
            if (local && atLeastAsNew(row.updated_at, local.updated_at)) {
              await cancelNotifications(local.notificationIds);
              set((state) => ({
                items: state.items.filter(
                  (item) =>
                    item.id !== row.id || newerThan(item.updated_at, row.updated_at),
                ),
              }));
            }
            continue;
          }

          const remote = cloud.rowToItem(row);
          if (!local) {
            if (pending?.kind === 'delete' && atLeastAsNew(pending.updatedAt, row.updated_at)) {
              continue;
            }
            await ensureSchedulingReady();
            remote.notificationIds = await scheduleForItem(remote);
            set((state) =>
              state.items.some((item) => item.id === remote.id)
                ? state
                : { items: [remote, ...state.items] },
            );
            continue;
          }

          if (newerThan(row.updated_at, local.updated_at)) {
            let notificationIds = local.notificationIds;
            if (scheduleFingerprint(remote) !== scheduleFingerprint(local)) {
              await ensureSchedulingReady();
              await cancelNotifications(local.notificationIds);
              notificationIds = await scheduleForItem(remote);
            }
            set((state) => ({
              items: state.items.map((item) =>
                item.id === remote.id && !newerThan(item.updated_at, remote.updated_at)
                  ? { ...remote, notificationIds }
                  : item,
              ),
            }));
          }
        }

        // Anything newer locally (including items created while signed out)
        // becomes a durable op for this account after the pull/merge phase.
        const cloudById = new Map(rows.map((row) => [row.id, row]));
        for (const item of get().items) {
          if (get().userId !== userId) return;
          const row = cloudById.get(item.id);
          const pending = pendingFor(item.id, userId);
          const needsUpload = !row || newerThan(item.updated_at, row.updated_at);
          if (needsUpload && (!pending || newerThan(item.updated_at, pending.updatedAt))) {
            queueUpsert(item);
          }
        }
      };

      return {
        items: [],
        hasHydrated: false,
        syncMode: 'local',
        userId: null,
        userEmail: null,
        syncing: false,
        syncError: null,
        lastSyncedAt: null,
        cacheOwnerId: null,
        pendingOps: [],

        addItem: (item) => {
          const normalised = normaliseItem(item);
          set((state) => ({ items: [normalised, ...state.items] }));
          queueUpsert(normalised);
        },

        removeItem: (id) => {
          const updatedAt = new Date().toISOString();
          set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
          queueDelete(id, updatedAt);
        },

        toggleDone: (id) => {
          const updatedAt = new Date().toISOString();
          set((state) => ({
            items: state.items.map((item) =>
              item.id === id ? { ...item, done: !item.done, updated_at: updatedAt } : item,
            ),
          }));
          const item = get().items.find((candidate) => candidate.id === id);
          if (item) queueUpsert(item);
        },

        updateItem: (id, patch) => {
          const updatedAt = new Date().toISOString();
          set((state) => ({
            items: state.items.map((item) =>
              item.id === id ? { ...item, ...patch, updated_at: updatedAt } : item,
            ),
          }));
          const item = get().items.find((candidate) => candidate.id === id);
          if (item) queueUpsert(item);
        },

        clearSyncError: () => set({ syncError: null }),

        flushPending: async () => {
          if (!isCloud()) return;
          if (flushRun) return flushRun;

          const userId = get().userId as string;
          flushRun = (async () => {
            while (true) {
              if (!isCloud() || get().userId !== userId) break;
              const op = get().pendingOps.find((candidate) => candidate.userId === userId);
              if (!op) break;
              try {
                if (op.kind === 'upsert') await cloud.upsertCloudItem(op.item);
                else await cloud.deleteCloudItem(op.itemId, op.updatedAt);
                set((state) => ({
                  pendingOps: state.pendingOps.filter((candidate) => candidate.opId !== op.opId),
                }));
              } catch (error) {
                if (!hasDatabaseCode(error)) break;
                const message = error instanceof Error ? error.message : String(error);
                if (op.attempts >= 2) {
                  set((state) => ({
                    pendingOps: state.pendingOps.filter(
                      (candidate) => candidate.opId !== op.opId,
                    ),
                    syncError: message,
                  }));
                } else {
                  set((state) => ({
                    pendingOps: state.pendingOps.map((candidate) =>
                      candidate.opId === op.opId
                        ? { ...candidate, attempts: candidate.attempts + 1 }
                        : candidate,
                    ),
                    syncError: message,
                  }));
                  break;
                }
              }
            }
          })().finally(() => {
            flushRun = null;
          });

          return flushRun;
        },

        syncNow: async () => {
          if (!isCloud()) return;
          if (syncRun) {
            syncAgain = true;
            return syncRun;
          }

          syncRun = (async () => {
            do {
              syncAgain = false;
              const userId = get().userId as string;
              set({ syncing: true, syncError: null });
              try {
                const rows = await cloud.fetchCloudItems(userId);
                if (!isCloud() || get().userId !== userId) {
                  syncAgain = true;
                  continue;
                }
                await mergeCloudRows(rows, userId);
                if (!isCloud() || get().userId !== userId) {
                  syncAgain = true;
                  continue;
                }
                await get().flushPending();
                if (get().userId === userId) {
                  set({ lastSyncedAt: new Date().toISOString() });
                }
              } catch (error) {
                set({
                  syncError: error instanceof Error ? error.message : String(error),
                });
              }
            } while (syncAgain && isCloud());
            set({ syncing: false });
          })().finally(() => {
            syncRun = null;
          });

          return syncRun;
        },

        bootstrapSync: async () => {
          if (!supabase || bootstrapStarted) return;
          bootstrapStarted = true;

          authSubscription?.unsubscribe();
          authSubscription = supabase.auth.onAuthStateChange((event, session) => {
            setTimeout(() => {
              if (event === 'SIGNED_OUT') leaveCloud();
              else if (session?.user && session.user.id !== get().userId) {
                void enterCloud(session.user.id, session.user.email ?? null);
              }
            }, 0);
          }).data.subscription;

          if (!appStateBound) {
            appStateBound = true;
            AppState.addEventListener('change', (state) => {
              if (state === 'active') void get().syncNow();
            });
          }

          try {
            const { data, error } = await supabase.auth.getSession();
            if (error) throw error;
            if (data.session?.user) {
              await enterCloud(
                data.session.user.id,
                data.session.user.email ?? null,
              );
            }
          } catch (error) {
            set({ syncError: error instanceof Error ? error.message : String(error) });
          }
        },

        signInWithPassword: async (email, password) => {
          if (!supabase) return { error: 'Supabase is not configured.' };
          const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) return { error: error.message };
          if (data.user) await enterCloud(data.user.id, data.user.email ?? null);
          return {};
        },

        signUpWithPassword: async (email, password) => {
          if (!supabase) return { error: 'Supabase is not configured.' };
          const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
          });
          if (error) return { error: error.message };
          if (data.session?.user) {
            await enterCloud(data.session.user.id, data.session.user.email ?? null);
            return {};
          }
          return { needsEmailConfirmation: true };
        },

        signInWithProvider: async (provider) => {
          return signInWithSocialProvider(provider);
        },

        signOut: async () => {
          try {
            await supabase?.auth.signOut();
          } finally {
            leaveCloud();
          }
        },
      };
    },
    {
      name: 'voice-reminder/items',
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        items: state.items,
        pendingOps: state.pendingOps,
        lastSyncedAt: state.lastSyncedAt,
        cacheOwnerId: state.cacheOwnerId,
      }),
      migrate: (persisted: any) => {
        if (!persisted) return persisted;
        persisted.items = (persisted.items ?? []).map((item: Item) => normaliseItem(item));
        persisted.pendingOps = (persisted.pendingOps ?? []).map((op: PendingSyncOp) =>
          op.kind === 'upsert' ? { ...op, item: normaliseItem(op.item) } : op,
        );
        persisted.cacheOwnerId = persisted.cacheOwnerId ?? null;
        return persisted;
      },
      onRehydrateStorage: () => () => {
        useStore.setState({ hasHydrated: true });
      },
    },
  ),
);

export { isSupabaseConfigured };
