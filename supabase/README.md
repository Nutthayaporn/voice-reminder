# Supabase setup — Voice Reminder

The app remains fully local when Supabase is absent or the user is signed out.
To enable account sync:

1. Apply the SQL files in `migrations/` in timestamp order in the Supabase SQL editor
   (or use `supabase db push` in a linked project). Existing installs need
   `20260831010000_item_alert_mode.sql` for the alarm/notification choice, then
   `20260831020000_reminder_persistence.sql` for Snooze/Until Done. The latest migration
   is self-contained and can also be rerun directly on older installs that do not yet have
   `alert_mode`.
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

`alert_mode`, `remind_until_done`, `snooze_minutes`, and `max_attempts` sync because they
are user intent. Native alarm runtime state and schedule IDs remain device-local.
`notificationIds` never sync. When a device downloads a reminder it creates a
fresh local notification or native alarm schedule for that device. Conflict resolution uses
the item's client edit time (`updated_at`), so device clocks should be set
automatically.
