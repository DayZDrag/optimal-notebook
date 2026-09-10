package app.vaultterminal.notebook;

import android.content.Intent;
import android.webkit.CookieManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoiceInputPlugin.class);
        registerPlugin(ReminderAlarmPlugin.class);
        super.onCreate(savedInstanceState);
        applyReminderWindow(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyReminderWindow(intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (getBridge() != null) {
            // The Capacitor origin is https://localhost and the API is Vercel.
            // Explicitly allow its Secure; SameSite=None session cookie in WebView.
            CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(), true);
        }
    }

    private void applyReminderWindow(Intent intent) {
        boolean reminder = intent != null && ReminderAlarmManager.ACTION_OPEN.equals(intent.getAction());
        if(Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(reminder);
            setTurnScreenOn(reminder);
        } else if(reminder) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
