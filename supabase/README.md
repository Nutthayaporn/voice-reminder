# Supabase setup — Voice Reminder

The app remains fully local when Supabase is absent or the user is signed out.
To enable account sync:

1. Apply `migrations/20260831000000_items_sync.sql` in the Supabase SQL editor
   (or with `supabase db push` in a linked project).
2. In **Authentication → Providers → Email**, keep email sign-in enabled.
3. In **Authentication → Email Templates → Magic Link**, include the six-digit
   token in the message body, for example:

   ```html
   <p>รหัสเข้าสู่ระบบ V.O.R.A. ของคุณคือ</p>
   <h2>{{ .Token }}</h2>
   ```

   The app verifies this token in-place; it does not consume a redirect link.
4. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`,
   then restart Expo.

`notificationIds` never sync. When a device downloads a reminder it creates a
fresh local notification schedule for that device. Conflict resolution uses
the item's client edit time (`updated_at`), so device clocks should be set
automatically.
