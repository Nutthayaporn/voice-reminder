# Supabase setup — Voice Reminder

The app remains fully local when Supabase is absent or the user is signed out.
To enable account sync:

1. Apply the SQL files in `migrations/` in timestamp order in the Supabase SQL editor
   (or use `supabase db push` in a linked project). Existing installs need
   `20260831010000_item_alert_mode.sql` for the alarm/notification choice, then
   `20260831020000_reminder_persistence.sql` for Snooze/Until Done. The latest migration
   is self-contained and can also be rerun directly on older installs that do not yet have
   `alert_mode`. Apply `20260831030000_shared_households.sql` to enable shared spaces and
   invite codes.
2. In **Authentication → Providers → Email**, keep email sign-in enabled. The app uses
   email/password signup and signin. If **Confirm email** is enabled, a new user must click the
   confirmation email before signing in; if it is disabled, signup creates a session immediately.
3. In **Authentication → URL Configuration → Redirect URLs**, add:

   - `voicereminder://auth/callback` for iOS and Android development/production builds
   - Each web origin used by the PWA, such as `http://localhost:8081` and the production HTTPS URL

   OAuth on native uses the app scheme declared in `app.json`. OAuth on web returns to the page
   that started sign-in, so every dev/staging/production origin must be allowed by Supabase.
4. To enable **Google**:

   - Create a Google OAuth 2.0 client of type **Web application**.
   - Add `https://<project-ref>.supabase.co/auth/v1/callback` as an Authorized redirect URI.
   - Put that client ID and secret in **Authentication → Providers → Google** in Supabase.

5. To enable **Facebook**:

   - Create a Meta app, add Facebook Login, and request the `email` permission.
   - Add `https://<project-ref>.supabase.co/auth/v1/callback` under **Valid OAuth Redirect URIs**.
   - Put the app ID and app secret in **Authentication → Providers → Facebook** in Supabase.
   - While the Meta app is in development mode, only admins/developers/testers can sign in.

   The provider callback above is Supabase's callback URL. Do not replace it with the
   `voicereminder://` app URL; Supabase redirects to the app only after the provider finishes.
6. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`,
   then restart Expo.

No Google or Facebook client secret belongs in the Expo environment or app bundle; secrets stay
in the Supabase provider settings.

`alert_mode`, `remind_until_done`, `snooze_minutes`, and `max_attempts` sync because they
are user intent. Native alarm runtime state and schedule IDs remain device-local.
`notificationIds` never sync. When a device downloads a reminder it creates a
fresh local notification or native alarm schedule for that device. Conflict resolution uses
the item's client edit time (`updated_at`), so device clocks should be set
automatically.

## Shared spaces

After the shared-households migration is applied, sign in on both devices. One person creates
a shared space in Settings and sends the displayed eight-character invite code to the other
person. The other person joins with that code. Selecting the space makes newly spoken reminders,
events, todos, and notes visible and editable by both members; selecting “เฉพาะฉัน” keeps new
items private.
