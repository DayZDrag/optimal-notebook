package app.vaultterminal.notebook;

import android.webkit.CookieManager;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoiceInputPlugin.class);
        registerPlugin(ReminderAlarmPlugin.class);
        super.onCreate(savedInstanceState);
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
}
