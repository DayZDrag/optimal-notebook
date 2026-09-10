package app.vaultterminal.notebook;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

/** Plays an actual alarm stream and repeating vibration after AlarmManager wakes the app. */
public class ReminderAlarmService extends Service {
    private static final String ACTION_START = "app.vaultterminal.notebook.ALARM_SERVICE_START";
    private static final String TEST_PREFIX = "__test__:";
    private static volatile String activeId;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vibrator;

    static void start(Context context, ReminderAlarmManager.Entry entry) {
        Intent service = new Intent(context, ReminderAlarmService.class)
                .setAction(ACTION_START)
                .putExtra("id", entry.id)
                .putExtra("title", entry.title)
                .putExtra("body", entry.body)
                .putExtra("at", entry.at);
        ContextCompat.startForegroundService(context, service);
    }

    static void stop(Context context, String id) {
        if(id != null && id.equals(activeId))context.stopService(new Intent(context, ReminderAlarmService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if(intent == null || !ACTION_START.equals(intent.getAction())) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        String id = intent.getStringExtra("id");
        if(id == null || id.trim().isEmpty()) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        String previousId = activeId;
        activeId = id;
        if(previousId != null && !previousId.equals(id))getSystemService(android.app.NotificationManager.class).cancel(ReminderAlarmManager.requestCode(previousId));
        ReminderAlarmManager.Entry entry = new ReminderAlarmManager.Entry(id, value(intent, "title", "Напоминание"), value(intent, "body", ""), intent.getLongExtra("at", System.currentTimeMillis()));
        Notification notification = ReminderAlarmManager.buildNotification(this, entry);
        if(Build.VERSION.SDK_INT >= 29)startForeground(ReminderAlarmManager.requestCode(id), notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ReminderAlarmManager.requestCode(id), notification);
        startSignal();
        if(id.startsWith(TEST_PREFIX))handler.postDelayed(()->{
            if(id.equals(activeId)) {
                getSystemService(android.app.NotificationManager.class).cancel(ReminderAlarmManager.requestCode(id));
                stopSelf();
            }
        }, 30_000L);
        return START_NOT_STICKY;
    }

    private static String value(Intent intent, String key, String fallback) {
        String value = intent.getStringExtra(key);
        return value == null ? fallback : value;
    }

    private void startSignal() {
        stopSignal();
        Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if(alarm == null)alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, alarm);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch(Exception unavailable) {
            if(player != null)player.release();
            player = null;
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        long[] pattern = new long[]{0, 700, 300, 700, 300, 1200};
        if(vibrator != null && vibrator.hasVibrator()) {
            if(Build.VERSION.SDK_INT >= 26)vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            else vibrator.vibrate(pattern, 0);
        }
    }

    private void stopSignal() {
        if(player != null) {
            try { if(player.isPlaying())player.stop(); } catch(IllegalStateException ignored) { }
            player.release();
            player = null;
        }
        if(vibrator != null)vibrator.cancel();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        stopSignal();
        activeId = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
