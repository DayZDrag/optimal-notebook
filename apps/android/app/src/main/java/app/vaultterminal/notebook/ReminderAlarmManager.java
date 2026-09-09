package app.vaultterminal.notebook;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Map;

/** Stores only reminder metadata locally. RAW notes and device tokens never enter this class. */
final class ReminderAlarmManager {
    static final String ACTION_FIRE = "app.vaultterminal.notebook.REMINDER_FIRE";
    static final String ACTION_DONE = "app.vaultterminal.notebook.REMINDER_DONE";
    static final String ACTION_SNOOZE = "app.vaultterminal.notebook.REMINDER_SNOOZE";
    static final String ACTION_OPEN = "app.vaultterminal.notebook.REMINDER_OPEN";
    static final String CHANNEL_ID = "vault_terminal_reminders";
    private static final String PREFS = "vault_terminal_reminders";
    private static final String SCHEDULE_PREFIX = "schedule:";
    private static final String ACTION_PREFIX = "action:";

    static final class Entry {
        final String id;
        final String title;
        final String body;
        final long at;

        Entry(String id, String title, String body, long at) {
            this.id = id;
            this.title = title;
            this.body = body;
            this.at = at;
        }

        JSONObject json() throws JSONException {
            JSONObject value = new JSONObject();
            value.put("id", id);
            value.put("title", title);
            value.put("body", body);
            value.put("at", at);
            return value;
        }

        static Entry from(JSONObject value) throws JSONException {
            return new Entry(value.getString("id"), value.optString("title", "Напоминание"), value.optString("body", ""), value.getLong("at"));
        }
    }

    private ReminderAlarmManager() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static int requestCode(String key) {
        return key.hashCode() & 0x7fffffff;
    }

    private static Uri actionUri(String action, String id) {
        return Uri.parse("vaultterminal-reminder://" + action.toLowerCase() + "/" + Uri.encode(id));
    }

    private static PendingIntent receiverIntent(Context context, String action, Entry entry) {
        Intent intent = new Intent(context, ReminderAlarmReceiver.class)
                .setAction(action)
                .setData(actionUri(action, entry.id))
                .putExtra("id", entry.id)
                .putExtra("title", entry.title)
                .putExtra("body", entry.body)
                .putExtra("at", entry.at);
        return PendingIntent.getBroadcast(context, requestCode(action + entry.id), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean notificationsAllowed(Context context) {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    static boolean exactAlarmsAllowed(Context context) {
        if(Build.VERSION.SDK_INT < 31)return true;
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarm.canScheduleExactAlarms();
    }

    static boolean fullScreenAllowed(Context context) {
        if(Build.VERSION.SDK_INT < 34)return true;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager.canUseFullScreenIntent();
    }

    static boolean schedule(Context context, Entry entry) {
        // The alarm can fire while the WebView is closed. Until the WebView
        // records that action in its offline queue, avoid re-scheduling that
        // same reminder when the app next starts.
        String pendingAction = pendingActionStatus(context, entry.id);
        if("FIRED".equals(pendingAction) || "DONE".equals(pendingAction)) return exactAlarmsAllowed(context);
        try {
            preferences(context).edit().putString(SCHEDULE_PREFIX + entry.id, entry.json().toString()).apply();
        } catch(JSONException ignored) { return false; }
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = receiverIntent(context, ACTION_FIRE, entry);
        alarm.cancel(pending);
        boolean exact = exactAlarmsAllowed(context);
        if(exact) alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Math.max(entry.at, System.currentTimeMillis() + 1_000L), pending);
        else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Math.max(entry.at, System.currentTimeMillis() + 1_000L), pending);
        return exact;
    }

    static void cancel(Context context, String id) {
        Entry placeholder = new Entry(id, "", "", 0);
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = receiverIntent(context, ACTION_FIRE, placeholder);
        alarm.cancel(pending);
        pending.cancel();
        preferences(context).edit().remove(SCHEDULE_PREFIX + id).apply();
        NotificationManagerCompat.from(context).cancel(requestCode(id));
    }

    static void rescheduleStored(Context context) {
        for(Map.Entry<String, ?> record : preferences(context).getAll().entrySet()) {
            if(!record.getKey().startsWith(SCHEDULE_PREFIX) || !(record.getValue() instanceof String))continue;
            try {
                Entry entry = Entry.from(new JSONObject((String) record.getValue()));
                if(entry.at <= System.currentTimeMillis())fire(context, entry);
                else schedule(context, entry);
            } catch(JSONException ignored) { preferences(context).edit().remove(record.getKey()).apply(); }
        }
    }

    static void fire(Context context, Entry entry) {
        preferences(context).edit().remove(SCHEDULE_PREFIX + entry.id).apply();
        recordAction(context, entry.id, "FIRED", entry.at);
        if(!notificationsAllowed(context))return;
        ensureChannel(context);
        Intent open = new Intent(context, MainActivity.class)
                .setAction(ACTION_OPEN)
                .setData(Uri.parse("vaultterminal://reminders/" + Uri.encode(entry.id)))
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("openReminders", true);
        PendingIntent openPending = PendingIntent.getActivity(context, requestCode("open" + entry.id), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent done = receiverIntent(context, ACTION_DONE, entry);
        PendingIntent snooze = receiverIntent(context, ACTION_SNOOZE, entry);
        String body = entry.body.isEmpty() ? "Пора вернуться к этой мысли" : entry.body;
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_reminder)
                .setContentTitle(entry.title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openPending)
                .setFullScreenIntent(openPending, true)
                .setOngoing(true)
                .setAutoCancel(false)
                .addAction(R.drawable.ic_stat_reminder, "Готово", done)
                .addAction(R.drawable.ic_stat_reminder, "На 10 минут", snooze);
        NotificationManagerCompat.from(context).notify(requestCode(entry.id), notification.build());
    }

    static void snooze(Context context, Entry entry) {
        cancel(context, entry.id);
        long at = System.currentTimeMillis() + 10 * 60_000L;
        Entry snoozed = new Entry(entry.id, entry.title, entry.body, at);
        schedule(context, snoozed);
        recordAction(context, entry.id, "SNOOZED", at);
    }

    static void done(Context context, Entry entry) {
        cancel(context, entry.id);
        recordAction(context, entry.id, "DONE", entry.at);
    }

    private static void recordAction(Context context, String id, String status, long at) {
        try {
            JSONObject action = new JSONObject();
            action.put("id", id);
            action.put("status", status);
            action.put("remindAt", at);
            preferences(context).edit().putString(ACTION_PREFIX + id, action.toString()).apply();
        } catch(JSONException ignored) { }
    }

    static Map<String, ?> records(Context context) {
        return preferences(context).getAll();
    }

    static void acknowledge(Context context, String id) {
        preferences(context).edit().remove(ACTION_PREFIX + id).apply();
    }

    private static String pendingActionStatus(Context context, String id) {
        String raw = preferences(context).getString(ACTION_PREFIX + id, null);
        if(raw == null)return null;
        try { return new JSONObject(raw).optString("status", null); }
        catch(JSONException ignored) { return null; }
    }

    private static void ensureChannel(Context context) {
        if(Build.VERSION.SDK_INT < 26)return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Напоминания", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Будильники и напоминания Vault Terminal");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 800});
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }
}
