import { supabase } from '../lib/supabase';

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  role: 'owner' | 'member';
  created_at: string;
}

function must() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export async function listHouseholds(): Promise<Household[]> {
  const { data, error } = await must().rpc('list_households');
  if (error) throw error;
  return (data ?? []) as Household[];
}

export async function createHousehold(name: string): Promise<Household> {
  const { data, error } = await must().rpc('create_household', { p_name: name.trim() });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Could not create the shared space.');
  return row as Household;
}

export async function joinHousehold(inviteCode: string): Promise<Household> {
  const { data, error } = await must().rpc('join_household', {
    p_invite_code: inviteCode.trim().toUpperCase(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Invite code not found.');
  return row as Household;
}
