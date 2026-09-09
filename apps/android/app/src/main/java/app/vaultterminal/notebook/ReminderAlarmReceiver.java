package app.vaultterminal.notebook;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** AlarmManager and notification actions reach this receiver even while the WebView is closed. */
public class ReminderAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if(Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action) || android.app.AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
            ReminderAlarmManager.rescheduleStored(context);
            return;
        }
        String id = intent.getStringExtra("id");
        if(id == null || id.trim().isEmpty())return;
        ReminderAlarmManager.Entry entry = new ReminderAlarmManager.Entry(id, intent.getStringExtra("title") == null ? "Напоминание" : intent.getStringExtra("title"), intent.getStringExtra("body") == null ? "" : intent.getStringExtra("body"), intent.getLongExtra("at", System.currentTimeMillis()));
        if(ReminderAlarmManager.ACTION_FIRE.equals(action))ReminderAlarmManager.fire(context, entry);
        else if(ReminderAlarmManager.ACTION_DONE.equals(action))ReminderAlarmManager.done(context, entry);
        else if(ReminderAlarmManager.ACTION_SNOOZE.equals(action))ReminderAlarmManager.snooze(context, entry);
    }
}
